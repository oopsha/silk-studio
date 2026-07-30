use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use url::Url;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpResponse {
    pub status: u16,
    pub body: String,
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

fn validate_ai_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|error| format!("Invalid URL: {error}"))?;
    if url.scheme() != "https" {
        return Err("AI provider URLs must use https.".into());
    }
    if url.username() != "" || url.password().is_some() {
        return Err("AI provider URLs must not include credentials.".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn ai_http_fetch(request: AiHttpRequest) -> Result<AiHttpResponse, String> {
    let url = validate_ai_url(&request.url)?;
    let method = request.method.trim().to_ascii_uppercase();
    if method.is_empty() {
        return Err("HTTP method is required.".into());
    }

    let mut headers = HeaderMap::new();
    for (key, value) in request.headers {
        let name = HeaderName::from_bytes(key.trim().as_bytes())
            .map_err(|_| format!("Invalid header name: {key}"))?;
        let header_value = HeaderValue::from_str(value.trim())
            .map_err(|_| format!("Invalid header value for {key}"))?;
        headers.insert(name, header_value);
    }

    let mut builder = http_client().request(
        method
            .parse()
            .map_err(|_| format!("Unsupported HTTP method: {method}"))?,
        url,
    );
    builder = builder.headers(headers);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("Network error while contacting AI provider: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read AI provider response: {error}"))?;

    Ok(AiHttpResponse { status, body })
}
