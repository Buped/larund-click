//! Isolated Python code-execution engine.
//!
//! This is the runtime half of the "Adatelemzés és kódfuttatás" capability: a
//! dedicated, narrow-purpose command (`code_execute`) that runs agent-authored
//! Python in a sandboxed, throwaway working directory — distinct from the broad
//! `process_start` shell launcher, which is intentionally NOT reused here.
//!
//! Isolation is layered and honest about platform limits:
//!   * A dedicated Larund-owned virtualenv (never the user's global Python), so
//!     package installs cannot pollute the user's system and the env is
//!     deletable/rebuildable.
//!   * A throwaway run directory (`<base>/.larund-code-runs/<run_id>/`) used as
//!     the process CWD, with input files copied in and new output files
//!     harvested out.
//!   * A best-effort STATIC analysis of the source before launch that rejects
//!     filesystem access outside the run dir, network use (unless explicitly
//!     allowed by the sandbox profile) and obvious sandbox-escape calls
//!     (subprocess / os.system / ctypes ...). Full OS-level sandboxing (seccomp /
//!     Job Objects / sandbox-exec) is NOT attempted here; see the writeup. The
//!     TS layer mirrors these checks for fast UX, but THIS is the authoritative
//!     gate — the code never reaches the interpreter if it fails here.
//!   * A hard wall-clock timeout with process kill, and byte-capped stdout/stderr
//!     so a runaway `print` loop cannot flood the host.

use base64::Engine;
use crate::artifacts::{preview, storage};
use serde::Deserialize;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// ─── Paths / runtime layout ───────────────────────────────────────────────────

/// The Larund-owned data root that holds the shared venv and (when there is no
/// workspace) the code-run scratch dirs. One venv is shared across workspaces —
/// it is a heavy artifact and there is no benefit to duplicating it per folder.
fn larund_data_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("larund-click")
}

fn venv_dir() -> PathBuf {
    larund_data_root().join("pyenv")
}

/// Path to the Python interpreter *inside* the venv, per-platform.
fn venv_python(venv: &Path) -> PathBuf {
    if cfg!(windows) {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

/// Where a run's scratch dir lives. Prefers the workspace so outputs sit next to
/// the user's project; falls back to the Larund data root.
fn runs_base(workspace_root: &Option<String>) -> PathBuf {
    match workspace_root.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(ws) => Path::new(ws).join(".larund-code-runs"),
        None => larund_data_root().join("code-runs"),
    }
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

// ─── System Python detection + venv management ────────────────────────────────

/// Candidate launchers, in priority order. `py -3` is the Windows launcher.
fn python_candidates() -> Vec<Vec<&'static str>> {
    if cfg!(windows) {
        vec![vec!["py", "-3"], vec!["python"], vec!["python3"]]
    } else {
        vec![vec!["python3"], vec!["python"]]
    }
}

/// Run `<candidate> --version` and accept it only if it is Python 3.x.
fn probe_python(candidate: &[&str]) -> Option<(Vec<String>, String)> {
    let mut cmd = Command::new(candidate[0]);
    for a in &candidate[1..] {
        cmd.arg(a);
    }
    cmd.arg("--version");
    hide_window(&mut cmd);
    let out = cmd.output().ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let version = text.trim().to_string();
    if version.contains("Python 3") {
        Some((candidate.iter().map(|s| s.to_string()).collect(), version))
    } else {
        None
    }
}

fn detect_system_python() -> Option<(Vec<String>, String)> {
    python_candidates().iter().find_map(|c| probe_python(c))
}

/// `pip list` inside the venv → set of installed package names (lowercased).
fn installed_packages(py: &Path) -> HashSet<String> {
    let mut cmd = Command::new(py);
    cmd.args(["-m", "pip", "list", "--disable-pip-version-check", "--format", "json"]);
    hide_window(&mut cmd);
    let Ok(out) = cmd.output() else { return HashSet::new() };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut set = HashSet::new();
    if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(&text) {
        for item in items {
            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                set.insert(name.to_lowercase());
            }
        }
    }
    set
}

/// Report the runtime state without mutating anything: is there a system Python,
/// does the venv exist, and what is installed. The TS layer uses this to decide
/// whether to surface a setup/approval step before the first run.
#[tauri::command]
pub async fn python_runtime_status() -> Result<String, String> {
    let system = detect_system_python();
    let venv = venv_dir();
    let py = venv_python(&venv);
    let venv_ready = py.exists();
    let installed: Vec<String> = if venv_ready {
        let mut v: Vec<String> = installed_packages(&py).into_iter().collect();
        v.sort();
        v
    } else {
        Vec::new()
    };

    Ok(serde_json::json!({
        "has_python": system.is_some(),
        "system_version": system.as_ref().map(|(_, v)| v.clone()),
        "venv_dir": venv.to_string_lossy(),
        "venv_python": py.to_string_lossy(),
        "venv_ready": venv_ready,
        "installed_packages": installed,
        "install_hint": if system.is_some() { serde_json::Value::Null } else {
            serde_json::json!("Python 3 was not found. Install it from https://www.python.org/downloads/ (or `winget install Python.Python.3` / `brew install python` / your distro's package manager), then retry.")
        },
    })
    .to_string())
}

/// Create the venv if missing. Optionally install/upgrade a set of packages
/// (the pre-approved base allowlist, or a targeted subset). Returns a JSON log.
#[tauri::command]
pub async fn python_ensure_runtime(packages: Option<Vec<String>>) -> Result<String, String> {
    let (system, _ver) = detect_system_python()
        .ok_or_else(|| "python_not_found: install Python 3 from https://www.python.org/downloads/ and retry.".to_string())?;
    let venv = venv_dir();
    if let Some(parent) = venv.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_data_dir_failed: {e}"))?;
    }
    let py = venv_python(&venv);
    let mut log: Vec<String> = Vec::new();

    if !py.exists() {
        let mut cmd = Command::new(&system[0]);
        for a in &system[1..] {
            cmd.arg(a);
        }
        cmd.args(["-m", "venv", &venv.to_string_lossy()]);
        hide_window(&mut cmd);
        let out = cmd.output().map_err(|e| format!("venv_spawn_failed: {e}"))?;
        if !out.status.success() {
            return Err(format!("venv_create_failed: {}", String::from_utf8_lossy(&out.stderr)));
        }
        log.push(format!("Created virtualenv at {}", venv.to_string_lossy()));
        // Make sure pip is current enough to fetch wheels.
        let mut up = Command::new(&py);
        up.args(["-m", "pip", "install", "--upgrade", "pip", "--disable-pip-version-check"]);
        hide_window(&mut up);
        let _ = up.output();
    }

    let pkgs = packages.unwrap_or_default();
    let mut installed_now: Vec<String> = Vec::new();
    if !pkgs.is_empty() {
        let already = installed_packages(&py);
        let todo: Vec<String> = pkgs
            .into_iter()
            .filter(|p| !already.contains(&pip_to_dist(p)))
            .collect();
        if !todo.is_empty() {
            let mut cmd = Command::new(&py);
            cmd.args(["-m", "pip", "install", "--disable-pip-version-check"]);
            for p in &todo {
                cmd.arg(p);
            }
            hide_window(&mut cmd);
            let out = cmd.output().map_err(|e| format!("pip_spawn_failed: {e}"))?;
            if !out.status.success() {
                return Err(format!(
                    "pip_install_failed for [{}]: {}",
                    todo.join(", "),
                    String::from_utf8_lossy(&out.stderr)
                ));
            }
            log.push(format!("Installed: {}", todo.join(", ")));
            installed_now = todo;
        }
    }

    Ok(serde_json::json!({
        "ok": true,
        "venv_python": py.to_string_lossy(),
        "installed_now": installed_now,
        "log": log,
    })
    .to_string())
}

/// Lowercase the dist name pip reports for a given requirement (e.g. "python-docx").
fn pip_to_dist(p: &str) -> String {
    p.split(&['=', '>', '<', '!', '~', '[' ][..]).next().unwrap_or(p).trim().to_lowercase()
}

/// Install ONE package. This is the approval-gated path the agent uses for a
/// package outside the base allowlist — the TS layer classifies it as
/// `process_exec` and asks the user first, so this never installs silently.
#[tauri::command]
pub async fn python_install_package(package: String) -> Result<String, String> {
    let pkg = package.trim().to_string();
    if pkg.is_empty() || !pkg.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=<>!~[]".contains(c)) {
        return Err(format!("invalid_package_name: '{package}'"));
    }
    python_ensure_runtime(Some(vec![pkg])).await
}

// ─── Static isolation analysis (best-effort, authoritative gate) ──────────────

/// Reject obvious sandbox-escape, network (when disallowed) and out-of-run-dir
/// filesystem access. This is a heuristic source scan, not a true sandbox — it is
/// intentionally conservative (false positives over false negatives).
fn static_isolation_check(code: &str, run_dir: &Path, input_names: &HashSet<String>, allow_network: bool) -> Result<(), String> {
    let lower = code.to_lowercase();

    // 1. Sandbox-escape / arbitrary host process control — always forbidden.
    const ESCAPE: &[(&str, &str)] = &[
        ("subprocess", "spawning host processes (subprocess)"),
        ("os.system", "shell execution (os.system)"),
        ("os.popen", "shell execution (os.popen)"),
        ("os.exec", "process replacement (os.exec*)"),
        ("os.spawn", "process spawning (os.spawn*)"),
        ("os.fork", "forking (os.fork)"),
        ("import ctypes", "native memory access (ctypes)"),
        ("import cffi", "native FFI (cffi)"),
        ("multiprocessing", "subprocess pools (multiprocessing)"),
        ("pty.spawn", "pseudo-terminal spawning"),
    ];
    for (needle, why) in ESCAPE {
        if lower.contains(needle) {
            return Err(format!("blocked_unsafe_code: {why} is not allowed in the sandbox."));
        }
    }

    // 2. Network — forbidden unless the sandbox profile explicitly allows it.
    if !allow_network {
        const NET: &[&str] = &[
            "import socket", "import requests", "import urllib", "from urllib", "import http.client",
            "import httpx", "import aiohttp", "import ftplib", "import smtplib", "import telnetlib",
            "urllib.request", "socket.socket", "requests.get", "requests.post", "http.client",
        ];
        for needle in NET {
            if lower.contains(needle) {
                return Err(format!(
                    "blocked_network: this code appears to use the network ('{needle}'), which is disabled. Set allow_network only when the task truly needs it — it always requires approval."
                ));
            }
        }
    }

    // 3. Filesystem — reject absolute paths outside the run dir, and home/user lookups.
    const HOME_LOOKUP: &[&str] = &[
        "expanduser", "path.home(", "pathlib.path.home", "os.environ", "getenv",
        "%userprofile%", "$home", "~/",
    ];
    for needle in HOME_LOOKUP {
        if lower.contains(needle) {
            return Err(format!(
                "blocked_fs: '{needle}' reads outside the sandbox working directory. Use relative paths inside the run folder and the explicitly provided input files only."
            ));
        }
    }

    // Scan quoted string literals for absolute paths that escape the run dir.
    let run_dir_norm = normalize_path(&run_dir.to_string_lossy());
    for literal in string_literals(code) {
        let slashy = literal.replace('\\', "/");
        if slashy == ".." || slashy.starts_with("../") || slashy.contains("/../") {
            return Err(format!(
                "blocked_fs: relative path traversal '{literal}' would leave the sandbox working directory. Use files inside the run folder only."
            ));
        }
        if is_absolute_path_literal(&literal) {
            let norm = normalize_path(&literal);
            let base = literal.rsplit(['/', '\\']).next().unwrap_or("").to_string();
            let within_run = norm.starts_with(&run_dir_norm);
            let is_input = input_names.contains(&base);
            if !within_run && !is_input {
                return Err(format!(
                    "blocked_fs: absolute path '{literal}' points outside the sandbox working directory. Reference inputs by their file name (they are copied into the run folder) and write outputs with relative paths."
                ));
            }
        }
    }

    Ok(())
}

fn normalize_path(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Heuristic: a Windows drive path (`C:\..`/`C:/..`), a UNC path (`\\..`) or a
/// POSIX absolute path (`/etc/..`). Bare relative names are not flagged.
fn is_absolute_path_literal(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
        return true;
    }
    if s.starts_with("\\\\") {
        return true;
    }
    if s.starts_with('/') && s.len() > 1 && !s.starts_with("//") {
        // Looks like a real rooted path (has a separator-ish structure), not a regex/url fragment.
        return s[1..].contains('/') || s.matches('/').count() >= 1;
    }
    false
}

/// Extract the contents of single/double-quoted string literals (no escaping
/// subtleties needed — this is a coarse safety scan, not a parser).
fn string_literals(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = code.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'"' || c == b'\'' {
            let quote = c;
            let start = i + 1;
            let mut j = start;
            while j < bytes.len() && bytes[j] != quote {
                if bytes[j] == b'\\' {
                    j += 2;
                    continue;
                }
                j += 1;
            }
            if j <= bytes.len() && j > start {
                if let Ok(s) = std::str::from_utf8(&bytes[start..j.min(bytes.len())]) {
                    out.push(s.to_string());
                }
            }
            i = j + 1;
        } else {
            i += 1;
        }
    }
    out
}

// ─── The executor ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct InputFile {
    pub src: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodeExecRequest {
    pub code: String,
    /// Resolved venv python (from python_runtime_status). When absent we resolve
    /// the shared venv ourselves.
    #[serde(default)]
    pub python_path: Option<String>,
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub input_files: Option<Vec<InputFile>>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub allow_network: Option<bool>,
    #[serde(default)]
    pub max_output_bytes: Option<usize>,
}

const DEFAULT_TIMEOUT: u64 = 45;
const MAX_TIMEOUT: u64 = 300;
const DEFAULT_OUTPUT_CAP: usize = 200_000; // ~200 KB of stdout/stderr each
const MAX_INLINE_TEXT: usize = 64_000;
const MAX_INLINE_IMAGE: usize = 4_000_000; // ~4 MB raw before base64

fn sanitize_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    base.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
        .collect::<String>()
        .trim()
        .to_string()
}

fn classify_ext(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "svg" => "image",
        "csv" | "tsv" => "csv",
        "json" => "json",
        "txt" | "md" | "log" => "text",
        "xlsx" | "xls" => "xlsx",
        "html" | "htm" => "html",
        _ => "file",
    }
}

fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        _ => "application/octet-stream",
    }
}

fn artifact_kind_for_generated_file(name: &str, classified: &str) -> &'static str {
    match classified {
        "image" => "image",
        "csv" => "csv",
        "xlsx" => "xlsx",
        "html" => "html",
        "json" | "text" => match name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
            "md" => "markdown",
            _ => "bundle",
        },
        _ => "bundle",
    }
}

fn verification_for_generated_file(path: &Path) -> serde_json::Value {
    let exists = path.exists();
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut errors = Vec::<String>::new();
    if !exists {
        errors.push("file_missing".to_string());
    }
    if exists && size == 0 {
        errors.push("file_empty".to_string());
    }
    serde_json::json!({
        "exists": exists,
        "readable": exists && size > 0 && errors.is_empty(),
        "pageCount": serde_json::Value::Null,
        "slideCount": serde_json::Value::Null,
        "wordCount": 0,
        "containsExpectedText": [],
        "warnings": [],
        "errors": errors,
    })
}

fn register_generated_artifact(
    run_dir: &Path,
    code_path: &Path,
    file_path: &Path,
    name: &str,
    kind: &str,
    mime: &str,
) -> Result<serde_json::Value, String> {
    let artifact_kind = artifact_kind_for_generated_file(name, kind);
    let title = format!("Code output - {name}");
    let (id, dir) = storage::new_artifact_dir(&title)?;
    let source_path = dir.join("source").join("_larund_main.py");
    let output_path = dir.join("output").join(storage::sanitize_part(name, "code-output"));
    std::fs::copy(code_path, &source_path).map_err(|e| format!("artifact_source_copy_failed: {e}"))?;
    std::fs::copy(file_path, &output_path).map_err(|e| format!("artifact_output_copy_failed: {e}"))?;

    let preview_path = if artifact_kind == "image" {
        let ext = output_path.extension().and_then(|e| e.to_str()).unwrap_or("png");
        let p = dir.join("preview").join(format!("thumbnail.{ext}"));
        std::fs::copy(&output_path, &p).map_err(|e| format!("artifact_preview_copy_failed: {e}"))?;
        p
    } else {
        preview::write_thumbnail(&dir.join("preview").join("thumbnail.png"), &title, artifact_kind)?
    };
    let preview_name = preview_path.file_name().and_then(|s| s.to_str()).unwrap_or("thumbnail.png");

    let mut manifest_value = storage::manifest(
        &id,
        &title,
        artifact_kind,
        None,
        vec![storage::file_entry(&source_path, "_larund_main.py", "text/x-python", "source")],
        vec![storage::file_entry(&output_path, name, mime, "output")],
        vec![storage::file_entry(&preview_path, preview_name, mime_for(preview_name), "preview")],
        verification_for_generated_file(&output_path),
    );
    manifest_value["metadata"] = serde_json::json!({
        "source": "code.execute",
        "runDir": run_dir.to_string_lossy(),
        "originalPath": file_path.to_string_lossy(),
    });
    storage::save_manifest(&dir, &manifest_value)?;
    Ok(manifest_value)
}

/// Drain a child pipe into a byte-capped buffer on its own thread, so a flood of
/// output cannot deadlock the parent or exhaust memory.
fn spawn_drainer<R: Read + Send + 'static>(mut reader: R, cap: usize) -> (Arc<Mutex<Vec<u8>>>, std::thread::JoinHandle<bool>) {
    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let buf2 = buf.clone();
    let handle = std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        let mut truncated = false;
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    let mut guard = buf2.lock().unwrap();
                    if guard.len() < cap {
                        let room = cap - guard.len();
                        guard.extend_from_slice(&chunk[..n.min(room)]);
                        if n > room {
                            truncated = true;
                        }
                    } else {
                        truncated = true;
                    }
                }
                Err(_) => break,
            }
        }
        truncated
    });
    (buf, handle)
}

#[tauri::command]
pub async fn code_execute(req: CodeExecRequest) -> Result<String, String> {
    let started = Instant::now();
    let allow_network = req.allow_network.unwrap_or(false);
    let timeout = req.timeout_secs.unwrap_or(DEFAULT_TIMEOUT).clamp(1, MAX_TIMEOUT);
    let out_cap = req.max_output_bytes.unwrap_or(DEFAULT_OUTPUT_CAP).clamp(1_000, 5_000_000);

    // Resolve interpreter: explicit > shared venv. The venv must already exist
    // (the TS layer ensures it before calling); we don't silently create it here.
    let py = match req.python_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => venv_python(&venv_dir()),
    };
    if !py.exists() {
        return Err(format!(
            "venv_not_ready: the Larund Python environment is not set up at {}. Run python_ensure_runtime first.",
            py.to_string_lossy()
        ));
    }

    // Create the throwaway run dir.
    let run_id = req
        .run_id
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("run-{}-{}", std::process::id(), now_ms()));
    let run_id = sanitize_name(&run_id).replace(' ', "-");
    let run_dir = runs_base(&req.workspace_root).join(&run_id);
    std::fs::create_dir_all(&run_dir).map_err(|e| format!("run_dir_create_failed: {e}"))?;

    // Copy inputs in (basename only — they become local, relative references).
    let mut input_names: HashSet<String> = HashSet::new();
    let mut copied: Vec<String> = Vec::new();
    if let Some(inputs) = &req.input_files {
        for f in inputs {
            let name = sanitize_name(&f.name);
            if name.is_empty() {
                continue;
            }
            let dest = run_dir.join(&name);
            match std::fs::copy(&f.src, &dest) {
                Ok(_) => {
                    input_names.insert(name.clone());
                    copied.push(name);
                }
                Err(e) => {
                    return Err(format!("input_copy_failed for '{}': {e}", f.src));
                }
            }
        }
    }

    // Authoritative static gate — the code never runs if this fails.
    static_isolation_check(&req.code, &run_dir, &input_names, allow_network)?;

    // Snapshot existing files so we can harvest only NEW outputs afterwards.
    let before: HashSet<String> = list_dir_files(&run_dir);

    // Write the entrypoint.
    let main_py = run_dir.join("_larund_main.py");
    std::fs::write(&main_py, &req.code).map_err(|e| format!("write_code_failed: {e}"))?;

    // Spawn the interpreter, CWD = run dir, hardened-ish environment.
    let mut cmd = Command::new(&py);
    cmd.arg("-I") // isolated mode: ignore PYTHON* env, user site-packages, cwd on sys.path[0] only
        .arg(&main_py)
        .current_dir(&run_dir)
        .env_clear()
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONUNBUFFERED", "1")
        .env("MPLBACKEND", "Agg") // headless matplotlib
        .env("MPLCONFIGDIR", run_dir.to_string_lossy().to_string())
        .env("HOME", run_dir.to_string_lossy().to_string())
        .env("TMPDIR", run_dir.to_string_lossy().to_string())
        .env("TEMP", run_dir.to_string_lossy().to_string())
        .env("TMP", run_dir.to_string_lossy().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Windows needs SystemRoot/PATH for the interpreter DLLs to load.
    if let Ok(v) = std::env::var("SystemRoot") {
        cmd.env("SystemRoot", v);
    }
    if let Ok(v) = std::env::var("PATH") {
        cmd.env("PATH", v);
    }
    hide_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("python_spawn_failed: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (out_buf, out_handle) = spawn_drainer(stdout, out_cap);
    let (err_buf, err_handle) = spawn_drainer(stderr, out_cap);

    // Wall-clock timeout via polling; kill on overrun.
    let deadline = Instant::now() + Duration::from_secs(timeout);
    let mut timed_out = false;
    let exit_code: Option<i32> = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => return Err(format!("wait_failed: {e}")),
        }
    };

    let out_trunc = out_handle.join().unwrap_or(false);
    let err_trunc = err_handle.join().unwrap_or(false);
    let stdout_text = String::from_utf8_lossy(&out_buf.lock().unwrap()).to_string();
    let stderr_text = String::from_utf8_lossy(&err_buf.lock().unwrap()).to_string();

    // Harvest NEW files (anything not present pre-run and not the entrypoint).
    let after = list_dir_files(&run_dir);
    let mut new_files: Vec<serde_json::Value> = Vec::new();
    for name in after.difference(&before) {
        if name == "_larund_main.py" {
            continue;
        }
        let path = run_dir.join(name);
        let kind = classify_ext(name);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let mut entry = serde_json::json!({
            "name": name,
            "path": path.to_string_lossy(),
            "kind": kind,
            "mime": mime_for(name),
            "size": size,
        });
        if kind == "image" && size as usize <= MAX_INLINE_IMAGE {
            if let Ok(bytes) = std::fs::read(&path) {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                entry["base64"] = serde_json::json!(b64);
            }
        } else if matches!(kind, "csv" | "json" | "text" | "html") {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let truncated = text.len() > MAX_INLINE_TEXT;
                entry["text"] = serde_json::json!(text.chars().take(MAX_INLINE_TEXT).collect::<String>());
                entry["text_truncated"] = serde_json::json!(truncated);
            }
        }
        if let Ok(manifest) = register_generated_artifact(&run_dir, &main_py, &path, name, kind, mime_for(name)) {
            entry["artifact_manifest"] = manifest;
        }
        new_files.push(entry);
    }
    new_files.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));

    let success = !timed_out && exit_code == Some(0);
    Ok(serde_json::json!({
        "success": success,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "duration_ms": started.elapsed().as_millis() as u64,
        "run_id": run_id,
        "run_dir": run_dir.to_string_lossy(),
        "python": py.to_string_lossy(),
        "allow_network": allow_network,
        "input_files": copied,
        "stdout": stdout_text,
        "stderr": stderr_text,
        "stdout_truncated": out_trunc,
        "stderr_truncated": err_trunc,
        "new_files": new_files,
    })
    .to_string())
}

/// List regular file names (not subdirs) directly in a directory.
fn list_dir_files(dir: &Path) -> HashSet<String> {
    let mut set = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                if let Some(name) = entry.file_name().to_str() {
                    set.insert(name.to_string());
                }
            }
        }
    }
    set
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> HashSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn blocks_subprocess_escape() {
        let run = PathBuf::from("/tmp/run1");
        let err = static_isolation_check("import subprocess\nsubprocess.run(['ls'])", &run, &HashSet::new(), false);
        assert!(err.is_err(), "subprocess must be blocked");
    }

    #[test]
    fn blocks_home_directory_read() {
        let run = PathBuf::from("/tmp/run1");
        let err = static_isolation_check("open('/etc/passwd').read()", &run, &HashSet::new(), false);
        assert!(err.is_err(), "absolute path outside run dir must be blocked");
        let err2 = static_isolation_check("from pathlib import Path\nPath.home()", &run, &HashSet::new(), false);
        assert!(err2.is_err(), "Path.home() must be blocked");
        let err3 = static_isolation_check("open('../secret.txt').read()", &run, &HashSet::new(), false);
        assert!(err3.is_err(), "relative traversal outside run dir must be blocked");
    }

    #[test]
    fn blocks_network_when_disallowed_but_allows_when_permitted() {
        let run = PathBuf::from("/tmp/run1");
        let code = "import requests\nrequests.get('https://example.com')";
        assert!(static_isolation_check(code, &run, &HashSet::new(), false).is_err());
        // With network allowed, the network check passes (subprocess etc. still apply).
        assert!(static_isolation_check("import requests", &run, &HashSet::new(), true).is_ok());
    }

    #[test]
    fn allows_plain_analysis_with_relative_paths() {
        let run = PathBuf::from("/tmp/run1");
        let code = "import statistics\nxs=[1,2,3,4,5]\nprint(statistics.mean(xs), statistics.pstdev(xs))\nopen('out.csv','w').write('a,b')";
        assert!(static_isolation_check(code, &run, &HashSet::new(), false).is_ok());
    }

    #[test]
    fn allows_declared_input_file_basename() {
        let run = PathBuf::from("/tmp/run1");
        let inputs = names(&["data.csv"]);
        // referencing the input by basename is fine
        let code = "import csv\nrows=list(csv.reader(open('data.csv')))\nprint(len(rows))";
        assert!(static_isolation_check(code, &run, &inputs, false).is_ok());
    }

    #[test]
    fn pip_to_dist_strips_specifiers() {
        assert_eq!(pip_to_dist("pandas==2.0"), "pandas");
        assert_eq!(pip_to_dist("python-docx"), "python-docx");
        assert_eq!(pip_to_dist("PyMuPDF>=1.20"), "pymupdf");
    }
}
