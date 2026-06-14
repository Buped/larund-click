// Deterministic, structured filesystem operations for the no-mouse operator.
// All paths support ~ expansion. These complement file_read/file_write/dir_list
// in agent.rs with mkdir/copy/move/delete/search/tree/exists/metadata.

use std::path::{Path, PathBuf};

fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            return path.replacen('~', &home.to_string_lossy(), 1);
        }
    }
    path.to_string()
}

#[tauri::command]
pub async fn fs_mkdir(path: String, recursive: Option<bool>) -> Result<String, String> {
    let p = expand_tilde(&path);
    if recursive.unwrap_or(true) {
        std::fs::create_dir_all(&p).map_err(|e| format!("mkdir failed: {}", e))?;
    } else {
        std::fs::create_dir(&p).map_err(|e| format!("mkdir failed: {}", e))?;
    }
    Ok(format!("Created {}", path))
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_copy(from: String, to: String) -> Result<String, String> {
    let src = expand_tilde(&from);
    let dst = expand_tilde(&to);
    let src_path = Path::new(&src);
    if src_path.is_dir() {
        copy_dir_all(src_path, Path::new(&dst)).map_err(|e| format!("copy failed: {}", e))?;
    } else {
        if let Some(parent) = Path::new(&dst).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::copy(&src, &dst).map_err(|e| format!("copy failed: {}", e))?;
    }
    Ok(format!("Copied {} -> {}", from, to))
}

#[tauri::command]
pub async fn fs_move(from: String, to: String) -> Result<String, String> {
    let src = expand_tilde(&from);
    let dst = expand_tilde(&to);
    if let Some(parent) = Path::new(&dst).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // rename fails across volumes; fall back to copy+delete.
    if std::fs::rename(&src, &dst).is_err() {
        let src_path = Path::new(&src);
        if src_path.is_dir() {
            copy_dir_all(src_path, Path::new(&dst)).map_err(|e| format!("move failed: {}", e))?;
            std::fs::remove_dir_all(&src).map_err(|e| format!("move cleanup failed: {}", e))?;
        } else {
            std::fs::copy(&src, &dst).map_err(|e| format!("move failed: {}", e))?;
            std::fs::remove_file(&src).map_err(|e| format!("move cleanup failed: {}", e))?;
        }
    }
    Ok(format!("Moved {} -> {}", from, to))
}

#[tauri::command]
pub async fn fs_delete(path: String, recursive: Option<bool>) -> Result<String, String> {
    let p = expand_tilde(&path);
    let path_ref = Path::new(&p);
    if path_ref.is_dir() {
        if recursive.unwrap_or(false) {
            std::fs::remove_dir_all(&p).map_err(|e| format!("delete failed: {}", e))?;
        } else {
            std::fs::remove_dir(&p).map_err(|e| format!("delete failed (use recursive for non-empty dir): {}", e))?;
        }
    } else {
        std::fs::remove_file(&p).map_err(|e| format!("delete failed: {}", e))?;
    }
    Ok(format!("Deleted {}", path))
}

#[tauri::command]
pub async fn fs_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&expand_tilde(&path)).exists())
}

#[tauri::command]
pub async fn fs_metadata(path: String) -> Result<String, String> {
    let p = expand_tilde(&path);
    let md = std::fs::metadata(&p).map_err(|e| format!("metadata failed: {}", e))?;
    let modified = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let json = serde_json::json!({
        "path": path,
        "is_dir": md.is_dir(),
        "is_file": md.is_file(),
        "size": md.len(),
        "readonly": md.permissions().readonly(),
        "modified_unix": modified,
    });
    Ok(json.to_string())
}

fn tree_recurse(dir: &Path, depth: i32, prefix: &str, out: &mut String) {
    if depth < 0 {
        return;
    }
    let mut entries: Vec<_> = match std::fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return,
    };
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.path().is_dir();
        out.push_str(prefix);
        out.push_str(&name);
        if is_dir {
            out.push('/');
        }
        out.push('\n');
        if is_dir && depth > 0 {
            let child_prefix = format!("{}  ", prefix);
            tree_recurse(&entry.path(), depth - 1, &child_prefix, out);
        }
    }
}

#[tauri::command]
pub async fn fs_tree(path: String, depth: Option<i32>) -> Result<String, String> {
    let p = expand_tilde(&path);
    let root = Path::new(&p);
    if !root.exists() {
        return Err(format!("path not found: {}", path));
    }
    let mut out = String::new();
    tree_recurse(root, depth.unwrap_or(2), "", &mut out);
    Ok(out)
}

fn glob_matches(name: &str, glob: &Option<String>) -> bool {
    match glob {
        None => true,
        Some(g) => {
            // Support simple "*.ext" / substring globs.
            if let Some(ext) = g.strip_prefix("*.") {
                name.ends_with(&format!(".{}", ext))
            } else {
                name.contains(g.trim_matches('*'))
            }
        }
    }
}

fn search_recurse(dir: &Path, query: &str, glob: &Option<String>, out: &mut Vec<String>, budget: &mut i32) {
    if *budget <= 0 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        if *budget <= 0 {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if name == "node_modules" || name == ".git" || name == "target" {
                continue;
            }
            search_recurse(&path, query, glob, out, budget);
        } else if glob_matches(&name, glob) {
            if let Ok(content) = std::fs::read_to_string(&path) {
                for (i, line) in content.lines().enumerate() {
                    if line.contains(query) {
                        out.push(format!("{}:{}: {}", path.display(), i + 1, line.trim()));
                        *budget -= 1;
                        if *budget <= 0 {
                            return;
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn fs_search(path: String, query: String, glob: Option<String>) -> Result<String, String> {
    let p = expand_tilde(&path);
    let root = PathBuf::from(&p);
    if !root.exists() {
        return Err(format!("path not found: {}", path));
    }
    let mut out: Vec<String> = Vec::new();
    let mut budget = 500i32;
    search_recurse(&root, &query, &glob, &mut out, &mut budget);
    if out.is_empty() {
        Ok(format!("No matches for \"{}\" in {}", query, path))
    } else {
        Ok(out.join("\n"))
    }
}
