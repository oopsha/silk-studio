//! SSM `DescribeInstanceInformation` / `StartSession` calls, SigV4-signed with the temporary
//! credentials obtained via [`crate::sso::SsoPortalClient::get_role_credentials`].

use crate::sigv4::{sign_json_post, AwsCredentials};
use serde::Deserialize;
use serde_json::json;

pub struct SsmClient {
    http: reqwest::Client,
    region: String,
    credentials: AwsCredentials,
}

#[derive(Debug, Clone)]
pub struct InstanceSummary {
    pub instance_id: String,
    pub name: Option<String>,
    pub ping_status: String,
    pub platform_type: String,
}

#[derive(Debug, Clone)]
pub struct StartSessionResult {
    pub session_id: String,
    pub token_value: String,
    pub stream_url: String,
    /// The exact `Target`/`DocumentName`/`Parameters` JSON sent to `StartSession` — the
    /// `session-manager-plugin` subprocess needs this same JSON verbatim as one of its
    /// launch arguments, so it's carried alongside the result rather than reconstructed.
    pub request_params_json: String,
}

impl SsmClient {
    pub fn new(http: reqwest::Client, region: impl Into<String>, credentials: AwsCredentials) -> Self {
        Self { http, region: region.into(), credentials }
    }

    fn host(&self) -> String {
        format!("ssm.{}.amazonaws.com", self.region)
    }

    async fn call<T: for<'de> Deserialize<'de>>(
        &self,
        target: &str,
        body: &serde_json::Value,
    ) -> Result<T, String> {
        let host = self.host();
        let body_bytes = serde_json::to_vec(body).map_err(|e| format!("failed to encode request: {e}"))?;
        let headers = sign_json_post(&self.credentials, &self.region, "ssm", &host, target, &body_bytes);

        let mut request = self.http.post(format!("https://{host}/")).body(body_bytes);
        for (name, value) in headers {
            request = request.header(name, value);
        }

        let response = request.send().await.map_err(|e| format!("{target} request failed: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(format!("{target} returned {status}: {text}"));
        }
        response.json().await.map_err(|e| format!("{target}: invalid response body: {e}"))
    }

    pub async fn describe_instance_information(&self) -> Result<Vec<InstanceSummary>, String> {
        #[derive(Deserialize)]
        struct RawInstance {
            #[serde(rename = "InstanceId")]
            instance_id: String,
            #[serde(rename = "ComputerName")]
            computer_name: Option<String>,
            #[serde(rename = "Name")]
            name: Option<String>,
            #[serde(rename = "PingStatus")]
            ping_status: String,
            #[serde(rename = "PlatformType")]
            platform_type: String,
        }
        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "InstanceInformationList", default)]
            instance_information_list: Vec<RawInstance>,
        }
        let resp: Resp = self
            .call("AmazonSSM.DescribeInstanceInformation", &json!({}))
            .await?;
        Ok(resp
            .instance_information_list
            .into_iter()
            .map(|raw| InstanceSummary {
                instance_id: raw.instance_id,
                name: raw.name.or(raw.computer_name),
                ping_status: raw.ping_status,
                platform_type: raw.platform_type,
            })
            .collect())
    }

    pub async fn start_session_for_port_forward(
        &self,
        target_instance_id: &str,
        remote_host: &str,
        remote_port: u16,
        local_port: u16,
    ) -> Result<StartSessionResult, String> {
        #[derive(Deserialize)]
        struct Resp {
            #[serde(rename = "SessionId")]
            session_id: String,
            #[serde(rename = "TokenValue")]
            token_value: String,
            #[serde(rename = "StreamUrl")]
            stream_url: String,
        }
        let request_body = json!({
            "Target": target_instance_id,
            "DocumentName": "AWS-StartPortForwardingSessionToRemoteHost",
            "Parameters": {
                "host": [remote_host],
                "portNumber": [remote_port.to_string()],
                "localPortNumber": [local_port.to_string()],
            },
        });
        let resp: Resp = self.call("AmazonSSM.StartSession", &request_body).await?;
        Ok(StartSessionResult {
            session_id: resp.session_id,
            token_value: resp.token_value,
            stream_url: resp.stream_url,
            request_params_json: request_body.to_string(),
        })
    }
}
