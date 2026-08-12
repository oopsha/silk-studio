//! Minimal AWS Signature Version 4 signer for JSON-1.1 protocol POST requests
//! (the shape used by SSM's `DescribeInstanceInformation`/`StartSession` APIs).
//! Deliberately hand-rolled instead of pulling in `aws-sdk-*` — see docs/bundled-runtime.md
//! and the ssm-tunnel plan for the rationale (avoids a second HTTP stack).

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
pub struct AwsCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    /// Present for temporary (SSO-derived) credentials; absent for static keys.
    pub session_token: Option<String>,
}

/// `X-Amz-Date` value (`YYYYMMDDTHHMMSSZ`) plus the plain `YYYYMMDD` credential-scope date.
pub struct AmzTimestamp {
    pub amz_date: String,
    pub date_stamp: String,
}

/// Current UTC time formatted for SigV4. Hand-rolled civil-date conversion (Howard Hinnant
/// algorithm) to avoid a chrono dependency, matching this repo's existing `app_log.rs` precedent.
pub fn now_amz_timestamp() -> AmzTimestamp {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let time = secs % 86_400;
    let hours = time / 3600;
    let minutes = (time % 3600) / 60;
    let seconds = time % 60;

    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    let date_stamp = format!("{year:04}{m:02}{d:02}");
    let amz_date = format!("{date_stamp}T{hours:02}{minutes:02}{seconds:02}Z");
    AmzTimestamp { amz_date, date_stamp }
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts a key of any length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Signs a JSON POST request for `service` (e.g. `"ssm"`) in `region`, returning the header
/// list to attach to the request (`Authorization`, `X-Amz-Date`, and `X-Amz-Security-Token`
/// when using temporary credentials). `host` must match the request's `Host` header exactly.
pub fn sign_json_post(
    credentials: &AwsCredentials,
    region: &str,
    service: &str,
    host: &str,
    target: &str,
    body: &[u8],
) -> Vec<(String, String)> {
    sign_json_post_at(credentials, region, service, host, target, body, now_amz_timestamp())
}

/// Same as [`sign_json_post`] but with an explicit timestamp — split out purely so the
/// signature math is deterministically testable without mocking `SystemTime::now()`.
pub fn sign_json_post_at(
    credentials: &AwsCredentials,
    region: &str,
    service: &str,
    host: &str,
    target: &str,
    body: &[u8],
    ts: AmzTimestamp,
) -> Vec<(String, String)> {
    sign_post_at(
        credentials,
        region,
        service,
        host,
        "application/x-amz-json-1.1",
        Some(target),
        body,
        ts,
    )
}

/// Signs a form-urlencoded POST for AWS's older "Query" protocol services (e.g. EC2), which
/// use `Action`/`Version` request parameters in the body instead of an `X-Amz-Target` header.
pub fn sign_form_post(
    credentials: &AwsCredentials,
    region: &str,
    service: &str,
    host: &str,
    body: &[u8],
) -> Vec<(String, String)> {
    sign_form_post_at(credentials, region, service, host, body, now_amz_timestamp())
}

pub fn sign_form_post_at(
    credentials: &AwsCredentials,
    region: &str,
    service: &str,
    host: &str,
    body: &[u8],
    ts: AmzTimestamp,
) -> Vec<(String, String)> {
    sign_post_at(
        credentials,
        region,
        service,
        host,
        "application/x-www-form-urlencoded; charset=utf-8",
        None,
        body,
        ts,
    )
}

/// Shared SigV4 POST signer. `target`, when present, adds an `X-Amz-Target` header (AWS JSON
/// protocol services); when absent, no such header is added (AWS Query protocol services).
/// Canonical headers are strictly sorted by lowercase name:
/// content-type, host, x-amz-date, [x-amz-security-token], [x-amz-target].
fn sign_post_at(
    credentials: &AwsCredentials,
    region: &str,
    service: &str,
    host: &str,
    content_type: &str,
    target: Option<&str>,
    body: &[u8],
    ts: AmzTimestamp,
) -> Vec<(String, String)> {
    let mut canonical_headers = format!(
        "content-type:{content_type}\nhost:{host}\nx-amz-date:{}\n",
        ts.amz_date
    );
    let mut signed_headers = "content-type;host;x-amz-date".to_string();
    if let Some(token) = &credentials.session_token {
        canonical_headers.push_str(&format!("x-amz-security-token:{token}\n"));
        signed_headers.push_str(";x-amz-security-token");
    }
    if let Some(target) = target {
        canonical_headers.push_str(&format!("x-amz-target:{target}\n"));
        signed_headers.push_str(";x-amz-target");
    }

    let canonical_request = format!(
        "POST\n/\n\n{canonical_headers}\n{signed_headers}\n{}",
        sha256_hex(body)
    );

    let credential_scope = format!("{}/{region}/{service}/aws4_request", ts.date_stamp);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{credential_scope}\n{}",
        ts.amz_date,
        sha256_hex(canonical_request.as_bytes())
    );

    let k_date = hmac_sha256(
        format!("AWS4{}", credentials.secret_access_key).as_bytes(),
        ts.date_stamp.as_bytes(),
    );
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
        credentials.access_key_id
    );

    let mut headers = vec![
        ("Authorization".to_string(), authorization),
        ("X-Amz-Date".to_string(), ts.amz_date),
        ("Content-Type".to_string(), content_type.to_string()),
    ];
    if let Some(target) = target {
        headers.push(("X-Amz-Target".to_string(), target.to_string()));
    }
    if let Some(token) = &credentials.session_token {
        headers.push(("X-Amz-Security-Token".to_string(), token.clone()));
    }
    headers
}

/// Tiny local hex-encode helper (avoids adding a `hex` crate dependency for one call site
/// beyond the two above, which reuse it).
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        let mut out = String::with_capacity(bytes.as_ref().len() * 2);
        for byte in bytes.as_ref() {
            out.push_str(&format!("{byte:02x}"));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_ts() -> AmzTimestamp {
        // 2015-08-30T12:36:00Z — the date used throughout AWS's published SigV4 worked
        // examples, chosen here only for a stable/recognizable fixture, not to reproduce
        // one of those examples byte-for-byte (this signer's canonical request shape,
        // fixed "/" path + JSON body, differs from the published query/form examples).
        AmzTimestamp { amz_date: "20150830T123600Z".into(), date_stamp: "20150830".into() }
    }

    fn creds() -> AwsCredentials {
        AwsCredentials {
            access_key_id: "AKIDEXAMPLE".into(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".into(),
            session_token: None,
        }
    }

    #[test]
    fn now_amz_timestamp_has_expected_shape() {
        let ts = now_amz_timestamp();
        assert_eq!(ts.date_stamp.len(), 8);
        assert_eq!(ts.amz_date.len(), 16);
        assert!(ts.amz_date.starts_with(&ts.date_stamp));
        assert!(ts.amz_date.ends_with('Z'));
    }

    #[test]
    fn signing_is_deterministic_for_the_same_inputs() {
        let headers_a = sign_json_post_at(
            &creds(), "us-east-1", "ssm", "ssm.us-east-1.amazonaws.com",
            "AmazonSSM.DescribeInstanceInformation", b"{}", fixed_ts(),
        );
        let headers_b = sign_json_post_at(
            &creds(), "us-east-1", "ssm", "ssm.us-east-1.amazonaws.com",
            "AmazonSSM.DescribeInstanceInformation", b"{}", fixed_ts(),
        );
        assert_eq!(headers_a, headers_b);
    }

    #[test]
    fn different_bodies_produce_different_signatures() {
        let auth_of = |body: &[u8]| {
            sign_json_post_at(
                &creds(), "us-east-1", "ssm", "ssm.us-east-1.amazonaws.com",
                "AmazonSSM.DescribeInstanceInformation", body, fixed_ts(),
            )
            .into_iter()
            .find(|(name, _)| name == "Authorization")
            .expect("Authorization header present")
            .1
        };
        assert_ne!(auth_of(b"{}"), auth_of(br#"{"MaxResults":10}"#));
    }

    #[test]
    fn session_token_is_included_when_present_and_omitted_when_absent() {
        let with_token = AwsCredentials { session_token: Some("FQoGZX...".into()), ..creds() };
        let signed = sign_json_post_at(
            &with_token, "us-east-1", "ssm", "ssm.us-east-1.amazonaws.com",
            "AmazonSSM.DescribeInstanceInformation", b"{}", fixed_ts(),
        );
        assert!(signed.iter().any(|(name, _)| name == "X-Amz-Security-Token"));
        assert!(signed
            .iter()
            .find(|(name, _)| name == "Authorization")
            .unwrap()
            .1
            .contains("x-amz-security-token"));

        let without_token = sign_json_post_at(
            &creds(), "us-east-1", "ssm", "ssm.us-east-1.amazonaws.com",
            "AmazonSSM.DescribeInstanceInformation", b"{}", fixed_ts(),
        );
        assert!(!without_token.iter().any(|(name, _)| name == "X-Amz-Security-Token"));
        assert!(!without_token
            .iter()
            .find(|(name, _)| name == "Authorization")
            .unwrap()
            .1
            .contains("x-amz-security-token"));
    }

    #[test]
    fn authorization_header_contains_credential_scope() {
        let headers = sign_json_post_at(
            &creds(), "us-east-1", "ssm", "ssm.us-east-1.amazonaws.com",
            "AmazonSSM.DescribeInstanceInformation", b"{}", fixed_ts(),
        );
        let auth = &headers.iter().find(|(name, _)| name == "Authorization").unwrap().1;
        assert!(auth.starts_with("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/ssm/aws4_request"));
    }

    /// AWS requires SignedHeaders (and the matching canonical header block) sorted strictly
    /// alphabetically by lowercase name. `x-amz-security-token` < `x-amz-target` — a real
    /// regression here (security-token appended last) previously caused every real SSM call
    /// (temporary SSO credentials always carry a session token) to fail with
    /// `InvalidSignatureException`.
    #[test]
    fn signed_headers_are_alphabetically_sorted_with_session_token() {
        let with_token = AwsCredentials { session_token: Some("FQoGZX...".into()), ..creds() };
        let headers = sign_json_post_at(
            &with_token, "us-east-1", "ssm", "ssm.us-east-1.amazonaws.com",
            "AmazonSSM.DescribeInstanceInformation", b"{}", fixed_ts(),
        );
        let auth = &headers.iter().find(|(name, _)| name == "Authorization").unwrap().1;
        assert!(auth.contains(
            "SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target,"
        ));
    }

    #[test]
    fn signed_headers_without_session_token() {
        let headers = sign_json_post_at(
            &creds(), "us-east-1", "ssm", "ssm.us-east-1.amazonaws.com",
            "AmazonSSM.DescribeInstanceInformation", b"{}", fixed_ts(),
        );
        let auth = &headers.iter().find(|(name, _)| name == "Authorization").unwrap().1;
        assert!(auth.contains("SignedHeaders=content-type;host;x-amz-date;x-amz-target,"));
    }
}
