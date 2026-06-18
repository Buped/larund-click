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

use serde::Serialize;

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

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
    // Append the HTTP status code after the body, behind a unique marker.
    args.push("-w".into());
    args.push(format!("{STATUS_MARKER}%{{http_code}}"));
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

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    if let Some((body_part, status_part)) = raw.rsplit_once(STATUS_MARKER) {
        let status = status_part.trim().parse::<u16>().unwrap_or(0);
        return Ok(HttpResponse { status, body: body_part.to_string() });
    }
    // No marker → curl never produced a response (network/TLS error).
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if err.is_empty() { "http_request failed: no response".into() } else { err })
}
