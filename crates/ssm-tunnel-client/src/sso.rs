//! AWS IAM Identity Center (SSO) login: the OIDC device-authorization flow (unsigned public
//! endpoints, browser-based) followed by the SSO Portal API (bearer-token REST, not SigV4)
//! to exchange the resulting access token for temporary IAM credentials.
//!
//! Flow: register_client -> start_device_authorization -> open `verification_uri_complete`
//! in the browser -> poll_token until the user finishes -> list_accounts/list_account_roles
//! (only if the caller doesn't already know which account/role to use) -> get_role_credentials.

use crate::sigv4::AwsCredentials;
use serde::Deserialize;
use serde_json::json;

const CLIENT_NAME: &str = "silk-db-studio";

pub struct SsoOidcClient {
    http: reqwest::Client,
    region: String,
}

#[derive(Debug, Clone)]
pub struct RegisteredClient {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone)]
pub struct DeviceAuthorization {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri_complete: String,
    pub interval_secs: u64,
    pub expires_in_secs: u64,
}

#[derive(Debug, Clone)]
pub struct SsoToken {
    pub access_token: String,
    pub expires_at_unix: u64,
}

impl SsoToken {
    /// True once the token is within `skew_secs` of its expiry (or already past it) — callers
    /// should treat "expiring soon" as "expired" to avoid racing a mid-request expiry.
    pub fn is_expired(&self, now_unix: u64, skew_secs: u64) -> bool {
        now_unix + skew_secs >= self.expires_at_unix
    }
}

/// Result of one `poll_token` attempt: the device flow hasn't produced a token yet, or a
/// terminal outcome (success or a reason to stop polling).
#[derive(Debug, Clone)]
pub enum PollOutcome {
    Pending,
    SlowDown,
    Complete(SsoToken),
    Expired,
    Denied,
}

impl SsoOidcClient {
    pub fn new(http: reqwest::Client, region: impl Into<String>) -> Self {
        Self { http, region: region.into() }
    }

    fn endpoint(&self, path: &str) -> String {
        format!("https://oidc.{}.amazonaws.com{path}", self.region)
    }

    pub async fn register_client(&self) -> Result<RegisteredClient, String> {
        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "clientId")]
            client_id: String,
            #[serde(rename = "clientSecret")]
            client_secret: String,
        }
        let resp: Resp = post_json(
            &self.http,
            &self.endpoint("/client/register"),
            &json!({ "clientName": CLIENT_NAME, "clientType": "public" }),
        )
        .await?;
        Ok(RegisteredClient { client_id: resp.client_id, client_secret: resp.client_secret })
    }

    pub async fn start_device_authorization(
        &self,
        client: &RegisteredClient,
        start_url: &str,
    ) -> Result<DeviceAuthorization, String> {
        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "deviceCode")]
            device_code: String,
            #[serde(rename = "userCode")]
            user_code: String,
            #[serde(rename = "verificationUriComplete")]
            verification_uri_complete: String,
            #[serde(rename = "interval")]
            interval_secs: u64,
            #[serde(rename = "expiresIn")]
            expires_in_secs: u64,
        }
        let resp: Resp = post_json(
            &self.http,
            &self.endpoint("/device_authorization"),
            &json!({
                "clientId": client.client_id,
                "clientSecret": client.client_secret,
                "startUrl": start_url,
            }),
        )
        .await?;
        Ok(DeviceAuthorization {
            device_code: resp.device_code,
            user_code: resp.user_code,
            verification_uri_complete: resp.verification_uri_complete,
            interval_secs: resp.interval_secs.max(1),
            expires_in_secs: resp.expires_in_secs,
        })
    }

    /// One poll attempt. The caller loops, sleeping `interval_secs` between calls (backing
    /// off further on `SlowDown`) until `Complete`/`Expired`/`Denied`.
    pub async fn poll_token(
        &self,
        client: &RegisteredClient,
        device_code: &str,
    ) -> Result<PollOutcome, String> {
        let response = self
            .http
            .post(self.endpoint("/token"))
            .json(&json!({
                "clientId": client.client_id,
                "clientSecret": client.client_secret,
                "grantType": "urn:ietf:params:oauth:grant-type:device_code",
                "deviceCode": device_code,
            }))
            .send()
            .await
            .map_err(|e| format!("SSO OIDC CreateToken request failed: {e}"))?;

        if response.status().is_success() {
            #[derive(Deserialize)]
            struct Resp {
                #[serde(rename = "accessToken")]
                access_token: String,
                #[serde(rename = "expiresIn")]
                expires_in: u64,
            }
            let resp: Resp = response
                .json()
                .await
                .map_err(|e| format!("SSO OIDC CreateToken: invalid response body: {e}"))?;
            let expires_at_unix = now_unix() + resp.expires_in;
            return Ok(PollOutcome::Complete(SsoToken {
                access_token: resp.access_token,
                expires_at_unix,
            }));
        }

        #[derive(Deserialize)]
        struct ErrResp {
            error: String,
        }
        let err: ErrResp = response
            .json()
            .await
            .unwrap_or(ErrResp { error: "unknown_error".to_string() });
        Ok(match err.error.as_str() {
            "authorization_pending" => PollOutcome::Pending,
            "slow_down" => PollOutcome::SlowDown,
            "expired_token" => PollOutcome::Expired,
            "access_denied" => PollOutcome::Denied,
            other => return Err(format!("SSO OIDC CreateToken failed: {other}")),
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SsoAccount {
    #[serde(rename = "accountId")]
    pub account_id: String,
    #[serde(rename = "accountName")]
    pub account_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SsoAccountRole {
    #[serde(rename = "roleName")]
    pub role_name: String,
    #[serde(rename = "accountId")]
    pub account_id: String,
}

pub struct SsoPortalClient {
    http: reqwest::Client,
    region: String,
}

impl SsoPortalClient {
    pub fn new(http: reqwest::Client, region: impl Into<String>) -> Self {
        Self { http, region: region.into() }
    }

    fn base(&self) -> String {
        format!("https://portal.sso.{}.amazonaws.com", self.region)
    }

    pub async fn list_accounts(&self, access_token: &str) -> Result<Vec<SsoAccount>, String> {
        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "accountList", default)]
            account_list: Vec<SsoAccount>,
        }
        let resp: Resp = get_bearer(
            &self.http,
            &format!("{}/assignment/accounts", self.base()),
            access_token,
        )
        .await?;
        Ok(resp.account_list)
    }

    pub async fn list_account_roles(
        &self,
        access_token: &str,
        account_id: &str,
    ) -> Result<Vec<SsoAccountRole>, String> {
        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "roleList", default)]
            role_list: Vec<SsoAccountRole>,
        }
        let resp: Resp = get_bearer(
            &self.http,
            &format!("{}/assignment/roles?account_id={account_id}", self.base()),
            access_token,
        )
        .await?;
        Ok(resp.role_list)
    }

    pub async fn get_role_credentials(
        &self,
        access_token: &str,
        account_id: &str,
        role_name: &str,
    ) -> Result<AwsCredentials, String> {
        #[derive(Deserialize)]
        struct RoleCreds {
            #[serde(rename = "accessKeyId")]
            access_key_id: String,
            #[serde(rename = "secretAccessKey")]
            secret_access_key: String,
            #[serde(rename = "sessionToken")]
            session_token: String,
        }
        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "roleCredentials")]
            role_credentials: RoleCreds,
        }
        let resp: Resp = get_bearer(
            &self.http,
            &format!(
                "{}/federation/credentials?role_name={role_name}&account_id={account_id}",
                self.base()
            ),
            access_token,
        )
        .await?;
        Ok(AwsCredentials {
            access_key_id: resp.role_credentials.access_key_id,
            secret_access_key: resp.role_credentials.secret_access_key,
            session_token: Some(resp.role_credentials.session_token),
        })
    }
}

async fn post_json<T: for<'de> Deserialize<'de>>(
    http: &reqwest::Client,
    url: &str,
    body: &serde_json::Value,
) -> Result<T, String> {
    let response = http
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("request to {url} failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("{url} returned {status}: {text}"));
    }
    response.json().await.map_err(|e| format!("{url}: invalid response body: {e}"))
}

async fn get_bearer<T: for<'de> Deserialize<'de>>(
    http: &reqwest::Client,
    url: &str,
    access_token: &str,
) -> Result<T, String> {
    let response = http
        .get(url)
        .header("x-amz-sso_bearer_token", access_token)
        .send()
        .await
        .map_err(|e| format!("request to {url} failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("{url} returned {status}: {text}"));
    }
    response.json().await.map_err(|e| format!("{url}: invalid response body: {e}"))
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_unix_is_a_plausible_recent_timestamp() {
        // Sanity bound only (year 2024 .. year 2100), not an exact-value test.
        let secs = now_unix();
        assert!(secs > 1_704_067_200); // 2024-01-01
        assert!(secs < 4_102_444_800); // 2100-01-01
    }

    fn token_expiring_at(expires_at_unix: u64) -> SsoToken {
        SsoToken { access_token: "tok".into(), expires_at_unix }
    }

    #[test]
    fn token_not_expired_well_before_expiry() {
        let token = token_expiring_at(1_000_000);
        assert!(!token.is_expired(900_000, 60));
    }

    #[test]
    fn token_expired_once_past_expiry() {
        let token = token_expiring_at(1_000_000);
        assert!(token.is_expired(1_000_001, 0));
    }

    #[test]
    fn token_treated_as_expired_within_skew_window() {
        let token = token_expiring_at(1_000_000);
        // 30s before actual expiry, with a 60s skew — should already count as expired.
        assert!(token.is_expired(999_970, 60));
    }
}
