use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}

pub fn sanitize_part(input: &str, fallback: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('-');
        }
    }
    let out = out.trim_matches(['.', '-', '_']).chars().take(80).collect::<String>();
    if out.is_empty() { fallback.to_string() } else { out }
}

pub fn artifact_root() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "artifact_storage_root_unavailable".to_string())?;
    Ok(base.join("Larund").join("artifacts"))
}

pub fn new_artifact_dir(title: &str) -> Result<(String, PathBuf), String> {
    let id = format!("artifact-{}", now_millis());
    let task = format!("task-{}", now_millis());
    let dir = artifact_root()?
        .join("local")
        .join(task)
        .join(format!("{}-{}", id, sanitize_part(title, "artifact")));
    std::fs::create_dir_all(dir.join("source")).map_err(|e| format!("artifact_source_mkdir_failed: {e}"))?;
    std::fs::create_dir_all(dir.join("output")).map_err(|e| format!("artifact_output_mkdir_failed: {e}"))?;
    std::fs::create_dir_all(dir.join("preview")).map_err(|e| format!("artifact_preview_mkdir_failed: {e}"))?;
    std::fs::create_dir_all(dir.join("logs")).map_err(|e| format!("artifact_logs_mkdir_failed: {e}"))?;
    Ok((id, dir))
}

pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("json_mkdir_failed: {e}"))?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| format!("json_write_failed:{}: {e}", path.display()))
}

pub fn file_entry(path: &Path, label: &str, mime_type: &str, role: &str) -> Value {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    json!({
        "id": format!("file-{}", now_millis()),
        "label": label,
        "path": path.to_string_lossy(),
        "mimeType": mime_type,
        "sizeBytes": size,
        "role": role,
    })
}

pub fn manifest(
    id: &str,
    title: &str,
    kind: &str,
    template_id: Option<String>,
    source_files: Vec<Value>,
    output_files: Vec<Value>,
    preview_files: Vec<Value>,
    verification: Value,
) -> Value {
    let now = now_iso();
    json!({
        "id": id,
        "workspaceId": "local",
        "taskId": "local",
        "title": title,
        "kind": kind,
        "requestedBy": "chat",
        "createdAt": now,
        "updatedAt": now,
        "status": if verification["errors"].as_array().map(|a| a.is_empty()).unwrap_or(true) { "ready" } else { "failed" },
        "sourceFiles": source_files,
        "outputFiles": output_files,
        "previewFiles": preview_files,
        "templateId": template_id,
        "designProfile": null,
        "verification": verification,
        "metadata": {},
    })
}

pub fn save_manifest(dir: &Path, value: &Value) -> Result<(), String> {
    write_json(&dir.join("artifact.json"), value)
}

pub fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            return path.replacen('~', &home.to_string_lossy(), 1);
        }
    }
    path.to_string()
}
