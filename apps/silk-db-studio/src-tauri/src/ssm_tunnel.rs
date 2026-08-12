//! Tauri commands for the built-in AWS SSM Session Manager tunnel: SSO device-flow login,
//! SSM-managed instance listing, and per-connection tunnel open/close.
//!
//! SSO access tokens are cached to disk (`app_data_dir()/sso-cache/{profileId}.json`), not the
//! OS credential store — see the ssm-tunnel plan for why (structured-JSON size limits on
//! Windows Credential Manager; this mirrors the real `aws sso login` CLI's own cache convention).

use serde::{Deserialize, Serialize};
use ssm_tunnel_client::sso::{PollOutcome, RegisteredClient, SsoOidcClient, SsoPortalClient, SsoToken};
use ssm_tunnel_client::{AwsCredentials, Ec2Client, InstanceSummary, SsmClient, TunnelManager};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, State};

const SSO_CACHE_DIR_NAME: &str = "sso-cache";
/// Treat a token as expired this many seconds before its real expiry, so a long-running
/// operation started right before expiry doesn't race a mid-call token death.
const TOKEN_EXPIRY_SKEW_SECS: u64 = 60;

pub struct SsmTunnelState {
    pub tunnels: TunnelManager,
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Silk DB Studio")
            .build()
            .expect("failed to build HTTP client")
    })
}

fn require_nonempty(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} is required."));
    }
    Ok(trimmed.to_string())
}

// ---- SSO token disk cache -------------------------------------------------------------

fn sso_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir: {error}"))?
        .join(SSO_CACHE_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| format!("Failed to create SSO cache dir: {error}"))?;
    Ok(dir)
}

/// `profile_id` is usually a UUID (already filename-safe), but for an unsaved profile the
/// frontend passes a synthetic `pending:<region>:<ssoStartUrl>` key (see `tunnelSessionKey` in
/// ssmTunnelTypes.ts) — the SSO Start URL's `:`/`/` are not valid in a Windows filename, so
/// sanitize whatever we're given rather than assume it's already safe.
fn sanitize_filename_component(raw: &str) -> String {
    let sanitized: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect();
    // Cap length defensively (long SSO URLs) — collisions are acceptable here since this is a
    // best-effort cache key, not an identity; a miss just means one extra browser login.
    sanitized.chars().take(200).collect()
}

fn sso_cache_file(app: &AppHandle, profile_id: &str) -> Result<PathBuf, String> {
    let safe_name = sanitize_filename_component(profile_id);
    Ok(sso_cache_dir(app)?.join(format!("{safe_name}.json")))
}

#[derive(Serialize, Deserialize)]
struct CachedToken {
    access_token: String,
    expires_at_unix: u64,
}

fn load_cached_token(app: &AppHandle, profile_id: &str) -> Option<SsoToken> {
    let path = sso_cache_file(app, profile_id).ok()?;
    let bytes = fs::read(path).ok()?;
    let cached: CachedToken = serde_json::from_slice(&bytes).ok()?;
    Some(SsoToken { access_token: cached.access_token, expires_at_unix: cached.expires_at_unix })
}

fn save_cached_token(app: &AppHandle, profile_id: &str, token: &SsoToken) -> Result<(), String> {
    let path = sso_cache_file(app, profile_id)?;
    let cached = CachedToken {
        access_token: token.access_token.clone(),
        expires_at_unix: token.expires_at_unix,
    };
    let bytes = serde_json::to_vec_pretty(&cached).map_err(|e| format!("Failed to encode SSO token: {e}"))?;
    fs::write(path, bytes).map_err(|e| format!("Failed to write SSO token cache: {e}"))
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Loads a still-valid cached token for `profile_id`, or `None` if there isn't one (missing or
/// expired) — callers should prompt the user through `ssm_sso_start_login` in that case.
fn valid_cached_token(app: &AppHandle, profile_id: &str) -> Option<SsoToken> {
    let token = load_cached_token(app, profile_id)?;
    if token.is_expired(now_unix(), TOKEN_EXPIRY_SKEW_SECS) {
        None
    } else {
        Some(token)
    }
}

/// Exchanges a cached SSO access token for temporary AWS credentials, taking the first
/// account/role returned (V1 scope — see the ssm-tunnel plan's "multi-account/role" V2 note).
async fn credentials_for_profile(
    app: &AppHandle,
    profile_id: &str,
    region: &str,
) -> Result<AwsCredentials, String> {
    let token = valid_cached_token(app, profile_id)
        .ok_or_else(|| "Not signed in to AWS SSO. Sign in first.".to_string())?;

    let portal = SsoPortalClient::new(http_client().clone(), region);
    let accounts = portal.list_accounts(&token.access_token).await?;
    let account = accounts
        .first()
        .ok_or_else(|| "This AWS SSO login has no assigned accounts.".to_string())?;
    let roles = portal.list_account_roles(&token.access_token, &account.account_id).await?;
    let role = roles
        .first()
        .ok_or_else(|| format!("No roles assigned in account {}.", account.account_id))?;
    portal
        .get_role_credentials(&token.access_token, &account.account_id, &role.role_name)
        .await
}

// ---- DTOs -------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthorizationDto {
    pub client_id: String,
    pub client_secret: String,
    pub device_code: String,
    pub user_code: String,
    pub verification_uri_complete: String,
    pub interval_secs: u64,
    pub expires_in_secs: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum SsoLoginStatusDto {
    Pending,
    SlowDown,
    Complete,
    Expired,
    Denied,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSummaryDto {
    pub instance_id: String,
    pub name: Option<String>,
    pub ping_status: String,
    pub platform_type: String,
}

impl From<InstanceSummary> for InstanceSummaryDto {
    fn from(value: InstanceSummary) -> Self {
        Self {
            instance_id: value.instance_id,
            name: value.name,
            ping_status: value.ping_status,
            platform_type: value.platform_type,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SsmTunnelOpenResultDto {
    pub local_port: u16,
}

// ---- Commands ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ssm_sso_start_login(region: String, start_url: String) -> Result<DeviceAuthorizationDto, String> {
    let region = require_nonempty(&region, "region")?;
    let start_url = require_nonempty(&start_url, "start_url")?;

    let oidc = SsoOidcClient::new(http_client().clone(), region);
    let client = oidc.register_client().await?;
    let device_auth = oidc.start_device_authorization(&client, &start_url).await?;

    Ok(DeviceAuthorizationDto {
        client_id: client.client_id,
        client_secret: client.client_secret,
        device_code: device_auth.device_code,
        user_code: device_auth.user_code,
        verification_uri_complete: device_auth.verification_uri_complete,
        interval_secs: device_auth.interval_secs,
        expires_in_secs: device_auth.expires_in_secs,
    })
}

#[tauri::command]
pub async fn ssm_sso_poll_login(
    app: AppHandle,
    profile_id: String,
    region: String,
    client_id: String,
    client_secret: String,
    device_code: String,
) -> Result<SsoLoginStatusDto, String> {
    let profile_id = require_nonempty(&profile_id, "profile_id")?;
    let region = require_nonempty(&region, "region")?;

    let oidc = SsoOidcClient::new(http_client().clone(), region);
    let client = RegisteredClient { client_id, client_secret };
    let outcome = oidc.poll_token(&client, &device_code).await?;

    Ok(match outcome {
        PollOutcome::Pending => SsoLoginStatusDto::Pending,
        PollOutcome::SlowDown => SsoLoginStatusDto::SlowDown,
        PollOutcome::Expired => SsoLoginStatusDto::Expired,
        PollOutcome::Denied => SsoLoginStatusDto::Denied,
        PollOutcome::Complete(token) => {
            save_cached_token(&app, &profile_id, &token)?;
            SsoLoginStatusDto::Complete
        }
    })
}

#[tauri::command]
pub fn ssm_sso_is_signed_in(app: AppHandle, profile_id: String) -> Result<bool, String> {
    let profile_id = require_nonempty(&profile_id, "profile_id")?;
    Ok(valid_cached_token(&app, &profile_id).is_some())
}

#[tauri::command]
pub async fn ssm_list_instances(
    app: AppHandle,
    profile_id: String,
    region: String,
) -> Result<Vec<InstanceSummaryDto>, String> {
    let profile_id = require_nonempty(&profile_id, "profile_id")?;
    let region = require_nonempty(&region, "region")?;

    let credentials = credentials_for_profile(&app, &profile_id, &region).await?;
    let ssm = SsmClient::new(http_client().clone(), region.clone(), credentials.clone());
    let instances = ssm.describe_instance_information().await?;

    // SSM's `Name` field is for on-premises/hybrid managed nodes, not EC2 tags — fetch the
    // EC2 "Name" tag separately and prefer it for display. Best-effort: if this call fails
    // (e.g. missing ec2:DescribeTags permission), fall back to SSM's own name/computer name
    // rather than failing the whole instance list.
    let instance_ids: Vec<String> = instances.iter().map(|i| i.instance_id.clone()).collect();
    let ec2 = Ec2Client::new(http_client().clone(), region, credentials);
    let name_tags = ec2.describe_instance_names(&instance_ids).await.unwrap_or_default();

    Ok(instances
        .into_iter()
        .map(|instance| {
            let mut dto = InstanceSummaryDto::from(instance);
            if let Some(tag_name) = name_tags.get(&dto.instance_id) {
                dto.name = Some(tag_name.clone());
            }
            dto
        })
        .collect())
}

#[tauri::command]
pub async fn ssm_tunnel_open(
    app: AppHandle,
    connection_id: String,
    profile_id: String,
    region: String,
    target_instance_id: String,
    remote_host: String,
    remote_port: u16,
    state: State<'_, SsmTunnelState>,
) -> Result<SsmTunnelOpenResultDto, String> {
    let connection_id = require_nonempty(&connection_id, "connection_id")?;
    let profile_id = require_nonempty(&profile_id, "profile_id")?;
    let region = require_nonempty(&region, "region")?;
    let target_instance_id = require_nonempty(&target_instance_id, "target_instance_id")?;
    let remote_host = require_nonempty(&remote_host, "remote_host")?;

    let credentials = credentials_for_profile(&app, &profile_id, &region).await?;
    let ssm = SsmClient::new(http_client().clone(), region.clone(), credentials);

    let local_port = TunnelManager::pick_free_local_port()?;
    let session = ssm
        .start_session_for_port_forward(&target_instance_id, &remote_host, remote_port, local_port)
        .await?;

    let endpoint = format!("https://ssm.{region}.amazonaws.com");
    state
        .tunnels
        .open(&connection_id, &session, &region, &endpoint, local_port)?;

    Ok(SsmTunnelOpenResultDto { local_port })
}

#[tauri::command]
pub fn ssm_tunnel_close(connection_id: String, state: State<'_, SsmTunnelState>) -> Result<(), String> {
    let connection_id = require_nonempty(&connection_id, "connection_id")?;
    state.tunnels.close(&connection_id);
    Ok(())
}

#[tauri::command]
pub fn ssm_tunnel_status(connection_id: String, state: State<'_, SsmTunnelState>) -> Result<bool, String> {
    let connection_id = require_nonempty(&connection_id, "connection_id")?;
    Ok(state.tunnels.is_open(&connection_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_component_keeps_a_plain_uuid_unchanged() {
        let uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
        assert_eq!(sanitize_filename_component(uuid), uuid);
    }

    #[test]
    fn sanitize_filename_component_strips_windows_illegal_characters() {
        let pending = "pending:ap-northeast-2:https://my-org.awsapps.com/start";
        let sanitized = sanitize_filename_component(pending);
        assert!(!sanitized.contains(':'));
        assert!(!sanitized.contains('/'));
        assert_eq!(
            sanitized,
            "pending_ap-northeast-2_https___my-org.awsapps.com_start",
        );
    }

    #[test]
    fn sanitize_filename_component_is_deterministic() {
        let input = "pending:us-east-1:https://example.awsapps.com/start";
        assert_eq!(
            sanitize_filename_component(input),
            sanitize_filename_component(input),
        );
    }
}
