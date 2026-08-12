//! EC2 `DescribeTags` (Query protocol, XML response) — used only to resolve the human-readable
//! "Name" tag for instances returned by SSM's `DescribeInstanceInformation`, which does not
//! include EC2 tags (its `Name` field is for on-premises/hybrid managed nodes, not EC2 tags).

use crate::sigv4::{sign_form_post, AwsCredentials};
use std::collections::HashMap;

pub struct Ec2Client {
    http: reqwest::Client,
    region: String,
    credentials: AwsCredentials,
}

impl Ec2Client {
    pub fn new(http: reqwest::Client, region: impl Into<String>, credentials: AwsCredentials) -> Self {
        Self { http, region: region.into(), credentials }
    }

    fn host(&self) -> String {
        format!("ec2.{}.amazonaws.com", self.region)
    }

    /// Returns `{instanceId: nameTagValue}` for whichever of `instance_ids` have a "Name" tag.
    /// Instances without one are simply absent from the map — callers should fall back to
    /// showing the bare instance id.
    pub async fn describe_instance_names(
        &self,
        instance_ids: &[String],
    ) -> Result<HashMap<String, String>, String> {
        if instance_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut params: Vec<(String, String)> = vec![
            ("Action".into(), "DescribeTags".into()),
            ("Version".into(), "2016-11-15".into()),
            ("Filter.1.Name".into(), "resource-id".into()),
        ];
        for (i, id) in instance_ids.iter().enumerate() {
            params.push((format!("Filter.1.Value.{}", i + 1), id.clone()));
        }
        params.push(("Filter.2.Name".into(), "key".into()));
        params.push(("Filter.2.Value.1".into(), "Name".into()));

        let body = encode_form(&params);
        let host = self.host();
        let headers = sign_form_post(&self.credentials, &self.region, "ec2", &host, body.as_bytes());

        let mut request = self.http.post(format!("https://{host}/")).body(body);
        for (name, value) in headers {
            request = request.header(name, value);
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("DescribeTags request failed: {e}"))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| format!("DescribeTags: invalid response body: {e}"))?;
        if !status.is_success() {
            return Err(format!("DescribeTags returned {status}: {text}"));
        }

        Ok(parse_name_tags(&text))
    }
}

fn encode_form(params: &[(String, String)]) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Minimal percent-encoding for AWS query-protocol form values (RFC 3986 unreserved set kept
/// literal, everything else percent-encoded) — instance ids/AWS parameter names never need
/// this in practice, but tag values could contain arbitrary characters.
fn percent_encode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Targeted extraction (not a general XML parser) for `DescribeTagsResponse`'s flat, stable
/// `<item><resourceId>..</resourceId>...<value>..</value></item>` shape.
fn parse_name_tags(xml: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for item in xml.split("<item>").skip(1) {
        let item = item.split("</item>").next().unwrap_or("");
        let resource_id = extract_first_tag(item, "resourceId");
        let value = extract_first_tag(item, "value");
        if let (Some(id), Some(name)) = (resource_id, value) {
            result.insert(id, name);
        }
    }
    result
}

fn extract_first_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml_unescape(&xml[start..end]))
}

fn xml_unescape(raw: &str) -> String {
    raw.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encode_keeps_unreserved_characters() {
        assert_eq!(percent_encode("i-0ae746f3993e5a11d"), "i-0ae746f3993e5a11d");
    }

    #[test]
    fn percent_encode_escapes_other_characters() {
        assert_eq!(percent_encode("a b/c"), "a%20b%2Fc");
    }

    #[test]
    fn encode_form_joins_pairs_with_ampersand() {
        let params = vec![("Action".to_string(), "DescribeTags".to_string()), ("Version".to_string(), "2016-11-15".to_string())];
        assert_eq!(encode_form(&params), "Action=DescribeTags&Version=2016-11-15");
    }

    #[test]
    fn parse_name_tags_extracts_resource_id_and_value_pairs() {
        let xml = r#"
<DescribeTagsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
  <requestId>abc</requestId>
  <tagSet>
    <item>
      <resourceId>i-0ae746f3993e5a11d</resourceId>
      <resourceType>instance</resourceType>
      <key>Name</key>
      <value>eldorado-backend-01</value>
    </item>
    <item>
      <resourceId>i-0431d3850e72252d6</resourceId>
      <resourceType>instance</resourceType>
      <key>Name</key>
      <value>eldorado-web</value>
    </item>
  </tagSet>
</DescribeTagsResponse>
"#;
        let names = parse_name_tags(xml);
        assert_eq!(names.get("i-0ae746f3993e5a11d").map(String::as_str), Some("eldorado-backend-01"));
        assert_eq!(names.get("i-0431d3850e72252d6").map(String::as_str), Some("eldorado-web"));
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn parse_name_tags_handles_empty_tag_set() {
        let xml = r#"<DescribeTagsResponse><requestId>abc</requestId><tagSet/></DescribeTagsResponse>"#;
        assert!(parse_name_tags(xml).is_empty());
    }

    #[test]
    fn parse_name_tags_unescapes_xml_entities_in_values() {
        let xml = "<item><resourceId>i-1</resourceId><value>a &amp; b</value></item>";
        assert_eq!(parse_name_tags(xml).get("i-1").map(String::as_str), Some("a & b"));
    }
}
