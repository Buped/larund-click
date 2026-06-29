// General-purpose HTTP from the Rust side. The webview cannot call endpoints that
// omit CORS headers (e.g. OAuth token endpoints like oauth2.googleapis.com/token),
// so the frontend routes those requests through this command instead.
//
// Implemented via the `curl` binary that ships with Windows 10/11 (and is present
// on macOS/Linux), so it adds NO Rust HTTP/TLS dependency — important on this
// project's clang-cl/xwin toolchain, where rustls+aws-lc-sys / openssl do not
// build. The request body is sent over stdin so secrets never appear in argv.

use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};

use encoding_rs::Encoding;
use serde::Serialize;

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

const CONTENT_TYPE_MARKER: &str = "\n__LARUND_HTTP_CONTENT_TYPE__";
const STATUS_MARKER: &str = "\n__LARUND_HTTP_STATUS__";

#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let mut args: Vec<String> = vec![
        "-s".into(),               // silent (no progress meter)
        "-S".into(),               // but still show errors
        "--max-time".into(),
        "30".into(),
        "-X".into(),
        method.to_uppercase(),
    ];
    if let Some(map) = headers {
        for (k, v) in map.iter() {
            args.push("-H".into());
            args.push(format!("{k}: {v}"));
        }
    }
    let has_body = body.is_some();
    if has_body {
        // Read the body from stdin so it never appears in the process argv.
        args.push("--data-binary".into());
        args.push("@-".into());
    }
    // Append metadata after the body, behind unique ASCII markers. Keep the body
    // as bytes until we know its charset; Hungarian public sites may still serve
    // windows-1250 or iso-8859-2.
    args.push("-w".into());
    args.push(format!("{CONTENT_TYPE_MARKER}%{{content_type}}{STATUS_MARKER}%{{http_code}}"));
    args.push(url);

    let mut child = Command::new("curl")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start curl: {e}"))?;

    if has_body {
        if let (Some(mut stdin), Some(b)) = (child.stdin.take(), body) {
            stdin
                .write_all(b.as_bytes())
                .map_err(|e| format!("failed to write request body: {e}"))?;
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("curl failed: {e}"))?;

    if let Some((body_bytes, content_type, status)) = split_curl_response(&output.stdout) {
        let body = decode_body(body_bytes, &content_type);
        return Ok(HttpResponse { status, body });
    }
    // No marker → curl never produced a response (network/TLS error).
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if err.is_empty() { "http_request failed: no response".into() } else { err })
}

fn split_curl_response(raw: &[u8]) -> Option<(&[u8], String, u16)> {
    let ct_marker = CONTENT_TYPE_MARKER.as_bytes();
    let status_marker = STATUS_MARKER.as_bytes();
    let status_pos = rfind_bytes(raw, status_marker)?;
    let ct_pos = rfind_bytes(&raw[..status_pos], ct_marker)?;
    let body = &raw[..ct_pos];
    let content_type = String::from_utf8_lossy(&raw[ct_pos + ct_marker.len()..status_pos]).trim().to_string();
    let status_text = String::from_utf8_lossy(&raw[status_pos + status_marker.len()..]).trim().to_string();
    let status = status_text.parse::<u16>().unwrap_or(0);
    Some((body, content_type, status))
}

fn rfind_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).rposition(|window| window == needle)
}

fn decode_body(bytes: &[u8], content_type: &str) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    if let Some(label) = charset_from_content_type(content_type).or_else(|| charset_from_meta(bytes)) {
        if let Some(decoded) = decode_with_label(bytes, &label) {
            return decoded;
        }
    }

    if let Some(decoded) = decode_utf8_if_clean(bytes) {
        return decoded;
    }

    // Central-European fallback. Prefer the candidate that produces fewer
    // replacement characters and more common Hungarian accented letters.
    let cp1250 = decode_with_label(bytes, "windows-1250").unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned());
    let iso = decode_with_label(bytes, "iso-8859-2").unwrap_or_else(|| cp1250.clone());
    if decode_score(&iso) > decode_score(&cp1250) { iso } else { cp1250 }
}

fn decode_utf8_if_clean(bytes: &[u8]) -> Option<String> {
    let (decoded, _, had_errors) = encoding_rs::UTF_8.decode(bytes);
    if had_errors { None } else { Some(decoded.into_owned()) }
}

fn decode_with_label(bytes: &[u8], label: &str) -> Option<String> {
    let enc = Encoding::for_label(label.trim().as_bytes())?;
    let (decoded, _, _) = enc.decode(bytes);
    Some(decoded.into_owned())
}

fn charset_from_content_type(content_type: &str) -> Option<String> {
    content_type
        .split(';')
        .find_map(|part| {
            let trimmed = part.trim();
            let (name, value) = trimmed.split_once('=')?;
            if name.trim().eq_ignore_ascii_case("charset") {
                Some(value.trim().trim_matches('"').trim_matches('\'').to_string())
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty())
}

fn charset_from_meta(bytes: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(8192)]).to_lowercase();
    if let Some(pos) = head.find("charset=") {
        let rest = &head[pos + "charset=".len()..];
        let label: String = rest
            .trim_start_matches(['"', '\'', ' '])
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
            .collect();
        if !label.is_empty() {
            return Some(label);
        }
    }
    None
}

fn decode_score(text: &str) -> i32 {
    let replacements = text.matches('\u{fffd}').count() as i32;
    let hu_letters = text.chars().filter(|c| "áéíóöőúüűÁÉÍÓÖŐÚÜŰ".contains(*c)).count() as i32;
    let mojibake = text.matches('�').count() as i32 + text.matches("Ã").count() as i32 + text.matches("Å").count() as i32;
    hu_letters * 2 - replacements * 10 - mojibake * 4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_windows_1250_body() {
        let text = "árvíztűrő tükörfúrógép június főbb mutatói";
        let enc = Encoding::for_label(b"windows-1250").unwrap();
        let (bytes, _, _) = enc.encode(text);
        let decoded = decode_body(&bytes, "text/html; charset=windows-1250");
        assert_eq!(decoded, text);
    }

    #[test]
    fn decodes_iso_8859_2_body() {
        let text = "árvíztűrő tükörfúrógép június főbb mutatói";
        let enc = Encoding::for_label(b"iso-8859-2").unwrap();
        let (bytes, _, _) = enc.encode(text);
        let decoded = decode_body(&bytes, "text/html; charset=iso-8859-2");
        assert_eq!(decoded, text);
    }

    #[test]
    fn keeps_clean_utf8_body() {
        let text = "népesség változása Magyarországon";
        assert_eq!(decode_body(text.as_bytes(), "text/html; charset=utf-8"), text);
    }

    #[test]
    fn splits_curl_response_without_decoding_body_first() {
        let mut raw = Vec::from("test".as_bytes());
        raw.extend_from_slice(CONTENT_TYPE_MARKER.as_bytes());
        raw.extend_from_slice(b"text/html; charset=utf-8");
        raw.extend_from_slice(STATUS_MARKER.as_bytes());
        raw.extend_from_slice(b"200");
        let (body, content_type, status) = split_curl_response(&raw).unwrap();
        assert_eq!(body, b"test");
        assert_eq!(content_type, "text/html; charset=utf-8");
        assert_eq!(status, 200);
    }
}
