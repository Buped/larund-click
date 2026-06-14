// Background process management for the no-mouse operator. Processes started
// here are tracked by id so the agent can poll status and kill them.

use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};

fn registry() -> &'static Mutex<HashMap<String, Child>> {
    static REG: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("proc-{}-{}", std::process::id(), ms)
}

#[tauri::command]
pub async fn process_start(
    command: String,
    working_dir: Option<String>,
    background: Option<bool>,
) -> Result<String, String> {
    let dir = working_dir.unwrap_or_else(|| {
        dirs::home_dir().unwrap_or_default().to_string_lossy().to_string()
    });

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", &command]);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", &command]);
        c
    };
    cmd.current_dir(&dir);

    let child = cmd.spawn().map_err(|e| format!("process_start failed: {}", e))?;
    let id = next_id();

    if background.unwrap_or(true) {
        registry().lock().unwrap().insert(id.clone(), child);
        Ok(serde_json::json!({ "process_id": id, "background": true }).to_string())
    } else {
        let mut child = child;
        let status = child.wait().map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "process_id": id, "exit_code": status.code(), "finished": true }).to_string())
    }
}

#[tauri::command]
pub async fn process_status(process_id: String) -> Result<String, String> {
    let mut reg = registry().lock().unwrap();
    let child = reg.get_mut(&process_id).ok_or_else(|| format!("unknown_process:{}", process_id))?;
    match child.try_wait() {
        Ok(Some(status)) => Ok(serde_json::json!({ "process_id": process_id, "running": false, "exit_code": status.code() }).to_string()),
        Ok(None) => Ok(serde_json::json!({ "process_id": process_id, "running": true }).to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn process_kill(process_id: String) -> Result<String, String> {
    let mut reg = registry().lock().unwrap();
    let mut child = reg.remove(&process_id).ok_or_else(|| format!("unknown_process:{}", process_id))?;
    child.kill().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "process_id": process_id, "killed": true }).to_string())
}
