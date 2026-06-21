use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

pub fn find_soffice() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.com",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "libreoffice",
        "soffice",
    ];
    candidates.iter().find_map(|candidate| {
        let path = PathBuf::from(candidate);
        if path.is_absolute() && path.exists() {
            Some(path)
        } else if !path.is_absolute() {
            Some(path)
        } else {
            None
        }
    })
}

pub fn convert(from: &Path, to: &str, out_dir: &Path) -> Result<PathBuf, String> {
    let soffice = find_soffice().ok_or_else(|| "blocked: LibreOffice is not installed or not on PATH".to_string())?;
    std::fs::create_dir_all(out_dir).map_err(|e| format!("convert_out_mkdir_failed: {e}"))?;
    let output = Command::new(&soffice)
        .arg("--headless")
        .arg("--convert-to")
        .arg(to)
        .arg("--outdir")
        .arg(out_dir)
        .arg(from)
        .output()
        .map_err(|e| format!("libreoffice_start_failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "libreoffice_convert_failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stem = from.file_stem().and_then(|s| s.to_str()).unwrap_or("converted");
    let result = out_dir.join(format!("{stem}.{to}"));
    if result.exists() {
        Ok(result)
    } else {
        Err(format!("libreoffice_output_missing:{}", result.display()))
    }
}

#[allow(dead_code)]
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
