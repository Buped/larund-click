use std::process::Command;
use std::path::Path;
use serde::Serialize;
use tauri::Manager;
use super::desktop;

// Brings a freshly launched app's window to the foreground on Windows. The agent
// works on the real desktop, so after launching an app we must make sure its
// window is actually visible and on top — otherwise screenshots capture whatever
// was already in front instead of the app the agent just opened.
#[cfg(target_os = "windows")]
mod win_focus {
    use std::collections::HashSet;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetWindowTextLengthW, IsWindowVisible, SetForegroundWindow,
        ShowWindow, SW_SHOWMAXIMIZED,
    };

    unsafe extern "system" fn collect_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
        let set = &mut *(lparam as *mut HashSet<isize>);
        set.insert(hwnd as isize);
        1
    }

    /// Snapshot of every top-level window handle that currently exists.
    pub unsafe fn snapshot_windows() -> HashSet<isize> {
        let mut set: HashSet<isize> = HashSet::new();
        EnumWindows(Some(collect_proc), &mut set as *mut _ as LPARAM);
        set
    }

    struct FindNew {
        before: *const HashSet<isize>,
        found: HWND,
    }

    unsafe extern "system" fn find_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
        let ctx = &mut *(lparam as *mut FindNew);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        if GetWindowTextLengthW(hwnd) <= 0 {
            return 1;
        }
        if (*ctx.before).contains(&(hwnd as isize)) {
            return 1;
        }
        ctx.found = hwnd;
        0 // stop enumerating — first new visible titled window wins
    }

    /// Finds a visible, titled window that appeared after `before` was captured,
    /// maximizes it and brings it to the foreground. Returns true if one was found.
    pub unsafe fn foreground_new_window(before: &HashSet<isize>) -> bool {
        let mut ctx = FindNew {
            before: before as *const _,
            found: std::ptr::null_mut(),
        };
        EnumWindows(Some(find_proc), &mut ctx as *mut _ as LPARAM);
        if ctx.found.is_null() {
            return false;
        }
        // Maximize so the app fills the screen and the agent can use accurate,
        // full-screen coordinates. SW_RESTORE would *shrink* an already-maximized
        // window (e.g. Chrome) — the opposite of what we want.
        ShowWindow(ctx.found, SW_SHOWMAXIMIZED);
        BringWindowToTop(ctx.found);
        SetForegroundWindow(ctx.found);
        true
    }
}

#[derive(Serialize)]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

#[tauri::command]
pub async fn shell_run(
    command: String,
    working_dir: Option<String>,
) -> Result<ShellOutput, String> {
    let dir = working_dir.unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    });

    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", &command])
        .current_dir(&dir)
        .output()
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .args(["-c", &command])
        .current_dir(&dir)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(ShellOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        success: output.status.success(),
    })
}

#[tauri::command]
pub async fn file_read(path: String) -> Result<String, String> {
    let expanded = expand_tilde(&path);
    std::fs::read_to_string(&expanded)
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
pub async fn file_write(
    path: String,
    content: String,
) -> Result<(), String> {
    let expanded = expand_tilde(&path);
    if let Some(parent) = Path::new(&expanded).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dirs: {}", e))?;
    }
    std::fs::write(&expanded, &content)
        .map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
pub async fn dir_list(path: String) -> Result<Vec<String>, String> {
    let expanded = expand_tilde(&path);
    let entries = std::fs::read_dir(&expanded)
        .map_err(|e| format!("Failed to list {}: {}", path, e))?;
    let mut files: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    files.sort();
    Ok(files)
}

// ─── Deterministic spreadsheet I/O ─────────────────────────────────────────────
// Read/write spreadsheets directly (xlsx via umya, csv natively; any format read
// via calamine) instead of GUI-typing into Calc/Excel.

#[tauri::command]
pub async fn sheet_read(
    path: String,
    sheet: Option<String>,
    max_rows: Option<usize>,
) -> Result<String, String> {
    let expanded = expand_tilde(&path);
    super::sheets::read(&expanded, sheet, max_rows)
}

#[tauri::command]
pub async fn sheet_write(
    path: String,
    sheet: Option<String>,
    rows: Option<Vec<Vec<String>>>,
    cells: Option<Vec<super::sheets::CellEdit>>,
    start_cell: Option<String>,
    mode: Option<String>,
) -> Result<String, String> {
    let expanded = expand_tilde(&path);
    super::sheets::write(&expanded, sheet, rows, cells, start_cell, mode)
}

#[tauri::command]
pub async fn app_open(name: String) -> Result<(), String> {
    if desktop::active_agent_desktop().is_some() {
        desktop::open_desktop_app(Some(name), None).map(|_| ())
    } else {
        #[cfg(target_os = "windows")]
        {
            let before = unsafe { win_focus::snapshot_windows() };
            desktop::open_desktop_app(Some(name), None).map(|_| ())?;
            for _ in 0..8 {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if unsafe { win_focus::foreground_new_window(&before) } {
                    break;
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .args(["-a", &name])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open")
                .arg(&name)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

// ─── Screenshot ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ScreenshotResult {
    pub base64: String,
    pub width: u32,
    pub height: u32,
    pub monitor_id: u32,
}

/// A rectangular screen region to zoom into for precise coordinate reading.
#[derive(serde::Deserialize)]
pub struct Region {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn take_screenshot(
    app: tauri::AppHandle,
    monitor_id: Option<u32>,
    grid: Option<bool>,
    region: Option<Region>,
) -> Result<ScreenshotResult, String> {
    if desktop::active_agent_desktop().is_some() {
        let captured = if let Some(region) = region {
            desktop::desktop_zoom_target_region(
                None,
                None,
                Some(desktop::DesktopReadRegion {
                    x: region.x,
                    y: region.y,
                    width: region.width as i32,
                    height: region.height as i32,
                }),
                Some(2),
            )?
        } else {
            desktop::agent_screenshot()?
        };
        return Ok(ScreenshotResult {
            base64: captured.base64,
            width: captured.width,
            height: captured.height,
            monitor_id: 0,
        });
    }

    use screenshots::Screen;
    use base64::{Engine as _, engine::general_purpose};
    use std::io::Cursor;

    let screens = Screen::all()
        .map_err(|e| format!("Failed to list screens: {}", e))?;

    let idx = monitor_id.unwrap_or(0) as usize;
    let screen = screens
        .get(idx)
        .ok_or_else(|| format!("Monitor {} not found", idx))?;

    // Hide the "agent running" border so it doesn't show up in the capture.
    let border = app.get_webview_window("agent-border");
    if let Some(b) = &border {
        let _ = b.hide();
        std::thread::sleep(std::time::Duration::from_millis(45));
    }
    let captured_res = screen.capture();
    if let Some(b) = &border {
        let _ = b.show();
    }
    let captured = captured_res.map_err(|e| format!("Screenshot failed: {}", e))?;

    let width = captured.width();
    let height = captured.height();

    // screenshots uses image 0.24 internally; extract raw bytes so we can
    // hand them to image 0.25 without a cross-version type mismatch.
    let raw_bytes = captured.into_raw();

    let mut buf = Vec::new();
    {
        let img = image::RgbaImage::from_raw(width, height, raw_bytes)
            .ok_or("Failed to create image buffer")?;
        let mut rgb = image::DynamicImage::ImageRgba8(img).to_rgb8();
        if let Some(reg) = region {
            // Zoom into the requested region and label the grid with ABSOLUTE
            // screen coordinates, so the model can read the exact click point.
            let (iw, ih) = rgb.dimensions();
            let rx = reg.x.clamp(0, iw as i32 - 1) as u32;
            let ry = reg.y.clamp(0, ih as i32 - 1) as u32;
            let rw = reg.width.clamp(1, iw - rx);
            let rh = reg.height.clamp(1, ih - ry);
            let cropped = image::imageops::crop_imm(&rgb, rx, ry, rw, rh).to_image();
            let scale = 2u32;
            let mut zoomed = image::imageops::resize(
                &cropped,
                rw * scale,
                rh * scale,
                image::imageops::FilterType::Triangle,
            );
            if grid.unwrap_or(true) {
                draw_region_grid(&mut zoomed, rx as i32, ry as i32, scale);
            }
            rgb = zoomed;
        } else if grid.unwrap_or(true) {
            draw_coordinate_grid(&mut rgb);
        }
        let mut cursor = Cursor::new(&mut buf);
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 80);
        image::DynamicImage::ImageRgb8(rgb)
            .write_with_encoder(encoder)
            .map_err(|e| e.to_string())?;
    }

    let base64_str = general_purpose::STANDARD.encode(&buf);

    Ok(ScreenshotResult {
        base64: base64_str,
        width,
        height,
        monitor_id: idx as u32,
    })
}

#[tauri::command]
pub async fn capture_screen_raw(
    app: tauri::AppHandle,
    monitor_id: Option<u32>,
) -> Result<ScreenshotResult, String> {
    take_screenshot(app, monitor_id, Some(false), None).await
}

#[tauri::command]
pub async fn capture_screen_region(
    app: tauri::AppHandle,
    monitor_id: Option<u32>,
    region: Region,
) -> Result<ScreenshotResult, String> {
    take_screenshot(app, monitor_id, Some(false), Some(region)).await
}

// ─── Mouse commands ───────────────────────────────────────────────────────────

async fn mouse_click(
    x: i32, y: i32,
    button: Option<String>,
) -> Result<(), String> {
    if desktop::active_agent_desktop().is_some() {
        return desktop::agent_mouse_click(x, y, button);
    }

    use enigo::{Enigo, Mouse, Settings, Button, Coordinate};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| e.to_string())?;
    let btn = match button.as_deref() {
        Some("right")  => Button::Right,
        Some("middle") => Button::Middle,
        _              => Button::Left,
    };
    enigo.move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(80));
    enigo.button(btn, enigo::Direction::Click)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mouse_click_verified(
    x: i32,
    y: i32,
    target_label: String,
    bbox: Vec<i32>,
    confidence: f32,
    source: String,
) -> Result<String, String> {
    if bbox.len() != 4 {
        return Err("invalid_verified_target: bbox must contain [x1,y1,x2,y2]".to_string());
    }
    let x1 = bbox[0];
    let y1 = bbox[1];
    let x2 = bbox[2];
    let y2 = bbox[3];
    if x2 <= x1 || y2 <= y1 {
        return Err("invalid_verified_target: bbox has non-positive size".to_string());
    }
    if x < x1 || x > x2 || y < y1 || y > y2 {
        return Err("invalid_verified_target: click point is outside bbox".to_string());
    }
    if !confidence.is_finite() || confidence < 0.0 || confidence > 1.0 {
        return Err("invalid_verified_target: confidence must be between 0 and 1".to_string());
    }
    mouse_click(x, y, Some("left".to_string())).await?;
    serde_json::to_string(&serde_json::json!({
        "clicked": true,
        "x": x,
        "y": y,
        "target_label": target_label,
        "bbox": bbox,
        "confidence": confidence,
        "source": source,
    })).map_err(|e| e.to_string())
}

// ─── Keyboard commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn type_text(text: String) -> Result<(), String> {
    if desktop::active_agent_desktop().is_some() {
        return desktop::agent_type_text(text);
    }

    use enigo::{Enigo, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(100));
    enigo.text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn key_press(key: String) -> Result<(), String> {
    if desktop::active_agent_desktop().is_some() {
        return desktop::agent_key_press(key);
    }

    use enigo::{Enigo, Keyboard, Settings, Key, Direction};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| e.to_string())?;
    let k = match key.to_lowercase().as_str() {
        "enter" | "return"  => Key::Return,
        "tab"               => Key::Tab,
        "escape" | "esc"    => Key::Escape,
        "backspace"         => Key::Backspace,
        "delete" | "del"    => Key::Delete,
        "space"             => Key::Space,
        "up"                => Key::UpArrow,
        "down"              => Key::DownArrow,
        "left"              => Key::LeftArrow,
        "right"             => Key::RightArrow,
        "home"              => Key::Home,
        "end"               => Key::End,
        "pageup"            => Key::PageUp,
        "pagedown"          => Key::PageDown,
        "f1"  => Key::F1,  "f2"  => Key::F2,
        "f3"  => Key::F3,  "f4"  => Key::F4,
        "f5"  => Key::F5,  "f6"  => Key::F6,
        "f7"  => Key::F7,  "f8"  => Key::F8,
        "f9"  => Key::F9,  "f10" => Key::F10,
        "f11" => Key::F11, "f12" => Key::F12,
        _ => Key::Unicode(key.chars().next().unwrap_or(' ')),
    };
    enigo.key(k, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn key_combo(keys: Vec<String>) -> Result<(), String> {
    if desktop::active_agent_desktop().is_some() {
        return desktop::agent_key_combo(keys);
    }

    use enigo::{Enigo, Keyboard, Settings, Key, Direction};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| e.to_string())?;

    fn str_to_key(s: &str) -> Option<Key> {
        match s.to_lowercase().as_str() {
            "ctrl" | "control" => Some(Key::Control),
            "alt"              => Some(Key::Alt),
            "shift"            => Some(Key::Shift),
            "win" | "meta"     => Some(Key::Meta),
            "enter"            => Some(Key::Return),
            "tab"              => Some(Key::Tab),
            "esc" | "escape"   => Some(Key::Escape),
            "space"            => Some(Key::Space),
            s if s.len() == 1  => s.chars().next().map(Key::Unicode),
            _                  => None,
        }
    }

    let parsed: Vec<Key> = keys.iter()
        .filter_map(|k| str_to_key(k))
        .collect();

    for k in &parsed {
        enigo.key(*k, Direction::Press)
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    for k in parsed.iter().rev() {
        enigo.key(*k, Direction::Release)
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    Ok(())
}

// ─── Extended CLI commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn clipboard_get() -> Result<String, String> {
    let output = {
        #[cfg(target_os = "windows")]
        {
            Command::new("powershell")
                .args(["-Command", "Get-Clipboard"])
                .output()
                .map_err(|e| e.to_string())?
        }
        #[cfg(not(target_os = "windows"))]
        {
            return Err("clipboard_get is only supported on Windows".to_string());
        }
    };
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn clipboard_set(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("powershell")
            .args(["-Command",
                   &format!("Set-Clipboard '{}'",
                            text.replace('\'', "''"))])
            .output()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        return Err("clipboard_set is only supported on Windows".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_screen_size(monitor_id: Option<u32>) -> Result<(u32, u32), String> {
    if desktop::active_agent_desktop().is_some() {
        return desktop::agent_get_screen_size();
    }

    use screenshots::Screen;
    let screens = Screen::all().map_err(|e| e.to_string())?;
    let idx = monitor_id.unwrap_or(0) as usize;
    let s = screens.get(idx).ok_or("Monitor not found")?;
    let info = s.display_info;
    Ok((info.width, info.height))
}

#[tauri::command]
pub async fn get_window_list() -> Result<Vec<String>, String> {
    if desktop::active_agent_desktop().is_some() {
        return desktop::agent_get_window_list();
    }

    let output = Command::new("powershell")
        .args(["-Command",
               "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -ExpandProperty MainWindowTitle"])
        .output()
        .map_err(|e| e.to_string())?;
    let list: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(list)
}

#[tauri::command]
pub async fn focus_window(title: String) -> Result<(), String> {
    if desktop::active_agent_desktop().is_some() {
        return desktop::agent_focus_window(title);
    }

    Command::new("powershell")
        .args(["-Command", &format!(
            "$wshell = New-Object -ComObject wscript.shell; \
             $wshell.AppActivate('{}')",
            title.replace('\'', "''")
        )])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn desktop_list_apps(query: Option<String>, limit: Option<usize>) -> Result<String, String> {
    let result = desktop::list_desktop_apps(query, limit)?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn desktop_open_app(name: Option<String>, app_id: Option<String>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    if desktop::active_agent_desktop().is_none() {
        let before = unsafe { win_focus::snapshot_windows() };
        let result = desktop::open_desktop_app(name, app_id)?;
        for _ in 0..8 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if unsafe { win_focus::foreground_new_window(&before) } {
                break;
            }
        }
        return Ok(result);
    }

    desktop::open_desktop_app(name, app_id)
}

#[tauri::command]
pub async fn desktop_read(
    mode: Option<String>,
    region: Option<desktop::DesktopReadRegion>,
) -> Result<String, String> {
    let result = desktop::desktop_read(mode, region)?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn desktop_read_debug(
    mode: Option<String>,
    region: Option<desktop::DesktopReadRegion>,
) -> Result<String, String> {
    let result = desktop::desktop_read_debug(mode, region)?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn desktop_resolve_target(id: String, snapshot_token: String) -> Result<String, String> {
    desktop::desktop_resolve_target(id, snapshot_token)
}

#[tauri::command]
pub async fn desktop_click_target(id: String, snapshot_token: String) -> Result<String, String> {
    desktop::desktop_click_target(id, snapshot_token)
}

#[tauri::command]
pub async fn desktop_double_click_target(id: String, snapshot_token: String) -> Result<String, String> {
    desktop::desktop_double_click_target(id, snapshot_token)
}

#[tauri::command]
pub async fn desktop_invoke_target(id: String, snapshot_token: String) -> Result<String, String> {
    desktop::desktop_invoke_target(id, snapshot_token)
}

#[tauri::command]
pub async fn desktop_focus_next() -> Result<String, String> {
    desktop::desktop_focus_next()
}

#[tauri::command]
pub async fn desktop_focus_prev() -> Result<String, String> {
    desktop::desktop_focus_prev()
}

#[tauri::command]
pub async fn desktop_read_focus() -> Result<String, String> {
    desktop::desktop_read_focus()
}

#[tauri::command]
pub async fn desktop_activate_focused() -> Result<String, String> {
    desktop::desktop_activate_focused()
}

#[tauri::command]
pub async fn desktop_type_target(id: String, text: String, snapshot_token: String) -> Result<String, String> {
    desktop::desktop_type_target(id, text, snapshot_token)
}

#[tauri::command]
pub async fn desktop_scroll_target(
    id: String,
    direction: String,
    amount: Option<i32>,
    snapshot_token: String,
) -> Result<String, String> {
    desktop::desktop_scroll_target(id, direction, amount.unwrap_or(1), snapshot_token)
}

#[tauri::command]
pub async fn desktop_capture_region(region: desktop::DesktopReadRegion) -> Result<ScreenshotResult, String> {
    let captured = desktop::desktop_capture_region(region)?;
    Ok(ScreenshotResult {
        base64: captured.base64,
        width: captured.width,
        height: captured.height,
        monitor_id: 0,
    })
}

#[tauri::command]
pub async fn desktop_zoom_target_region(
    id: Option<String>,
    snapshot_token: Option<String>,
    region: Option<desktop::DesktopReadRegion>,
    zoom: Option<u32>,
) -> Result<ScreenshotResult, String> {
    let captured = desktop::desktop_zoom_target_region(id, snapshot_token, region, zoom)?;
    Ok(ScreenshotResult {
        base64: captured.base64,
        width: captured.width,
        height: captured.height,
        monitor_id: 0,
    })
}

#[tauri::command]
pub async fn ocr_read(region: Option<desktop::DesktopReadRegion>) -> Result<String, String> {
    desktop::ocr_read(region)
}

#[tauri::command]
pub async fn ocr_read_region(region: desktop::DesktopReadRegion) -> Result<String, String> {
    desktop::ocr_read(Some(region))
}

#[tauri::command]
pub async fn send_notification(
    title: String,
    message: String,
) -> Result<(), String> {
    Command::new("powershell")
        .args(["-Command", &format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             $notify = New-Object System.Windows.Forms.NotifyIcon; \
             $notify.Icon = [System.Drawing.SystemIcons]::Information; \
             $notify.Visible = $true; \
             $notify.ShowBalloonTip(3000, '{}', '{}', \
             [System.Windows.Forms.ToolTipIcon]::None)",
            title.replace('\'', "''"),
            message.replace('\'', "''")
        )])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Main window control ──────────────────────────────────────────────────────
// Done in Rust (not JS) because window setters like minimize/unminimize require
// explicit Tauri capability permissions when called from a webview, but Rust-side
// calls bypass that gate. The agent minimises the chat window while it works on
// the real desktop so the chat doesn't occlude the apps it needs to see.

#[tauri::command]
pub async fn minimize_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn restore_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        // A brief always-on-top toggle reliably pulls the chat above other apps
        // (e.g. the agent browser) so the user actually sees an asked question.
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        let _ = window.set_always_on_top(false);
    }
    Ok(())
}

// ─── "Agent running" screen border ────────────────────────────────────────────
// A full-screen, transparent, click-through, always-on-top frame so the user
// can see at a glance that the agent is working. It is hidden during
// take_screenshot so it never appears in the agent's own captures.

#[tauri::command]
pub async fn show_agent_border(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    if app.get_webview_window("agent-border").is_some() {
        return Ok(());
    }
    let (w, h, x, y) = match app.primary_monitor() {
        Ok(Some(m)) => {
            let s = m.size();
            let p = m.position();
            (s.width, s.height, p.x, p.y)
        }
        _ => (1920, 1080, 0, 0),
    };
    let win = WebviewWindowBuilder::new(&app, "agent-border", WebviewUrl::App("border.html".into()))
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = win.set_size(tauri::PhysicalSize::new(w, h));
    let _ = win.set_ignore_cursor_events(true);
    Ok(())
}

#[tauri::command]
pub async fn hide_agent_border(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("agent-border") {
        let _ = win.close();
    }
    Ok(())
}

// ─── Virtual desktop commands ─────────────────────────────────────────────────

/// Ensures the PowerShell VirtualDesktop module exists, installing it for the
/// current user if needed.
#[cfg(target_os = "windows")]
async fn ensure_virtual_desktop_module() -> Result<(), String> {
    let import_check = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Import-Module VirtualDesktop -ErrorAction Stop; 'ok'",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if import_check.status.success() {
        return Ok(());
    }

    let install = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Install-PackageProvider NuGet -Force -Scope CurrentUser -ErrorAction Stop | Out-Null; \
             Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction Stop; \
             Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force; \
             Install-Module VirtualDesktop -Scope CurrentUser -Force -AllowClobber -Confirm:$false -ErrorAction Stop",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !install.status.success() {
        return Err(format!(
            "Failed to install VirtualDesktop module: {}",
            String::from_utf8_lossy(&install.stderr)
        ));
    }

    let recheck = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Import-Module VirtualDesktop -ErrorAction Stop; 'ok'",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if recheck.status.success() {
        Ok(())
    } else {
        Err(format!(
            "VirtualDesktop module import still failed: {}",
            String::from_utf8_lossy(&recheck.stderr)
        ))
    }
}

/// Creates a new Windows virtual desktop without switching the user away from
/// the current chat desktop.
#[tauri::command]
pub async fn create_virtual_desktop() -> Result<String, String> {
    let info = desktop::create_agent_desktop()?;
    Ok(info.id.to_string())
}

/// Keeps compatibility for any older flows, but the agent no longer uses it.
#[tauri::command]
pub async fn switch_to_desktop(index: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        ensure_virtual_desktop_module().await?;
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "Import-Module VirtualDesktop -ErrorAction Stop; Switch-Desktop -Desktop {} -NoAnimation",
                    index
                ),
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            return Ok(());
        }
        return Err(format!(
            "Failed to switch desktop: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = index;
        Err("Virtual desktops are only supported on Windows".to_string())
    }
}

/// Removes the agent desktop by index without touching the user's current
/// visible desktop.
#[tauri::command]
pub async fn close_virtual_desktop(index: u32) -> Result<(), String> {
    desktop::close_agent_desktop(index)
}

// ─── Coordinate grid overlay ──────────────────────────────────────────────────
// A subtle labelled grid drawn onto agent screenshots so the vision model can
// read pixel coordinates accurately before clicking. Uses a tiny hand-rolled
// 3×5 digit font so no extra dependency is needed.

// Each digit is 5 rows; the low 3 bits of each value are the left/middle/right
// columns (bit 2 = left).
const FONT_3X5: [[u8; 5]; 10] = [
    [7, 5, 5, 5, 7], // 0
    [2, 6, 2, 2, 7], // 1
    [7, 1, 7, 4, 7], // 2
    [7, 1, 7, 1, 7], // 3
    [5, 5, 7, 1, 1], // 4
    [7, 4, 7, 1, 7], // 5
    [7, 4, 7, 5, 7], // 6
    [7, 1, 2, 2, 2], // 7
    [7, 5, 7, 5, 7], // 8
    [7, 5, 7, 1, 7], // 9
];

fn blend_px(p: &mut image::Rgb<u8>, color: (u8, u8, u8), a: f32) {
    let inv = 1.0 - a;
    p.0[0] = (p.0[0] as f32 * inv + color.0 as f32 * a) as u8;
    p.0[1] = (p.0[1] as f32 * inv + color.1 as f32 * a) as u8;
    p.0[2] = (p.0[2] as f32 * inv + color.2 as f32 * a) as u8;
}

fn draw_digit(img: &mut image::RgbImage, d: u8, x: i32, y: i32, scale: i32, color: image::Rgb<u8>) {
    let (w, h) = img.dimensions();
    let glyph = FONT_3X5[(d % 10) as usize];
    for (row, bits) in glyph.iter().enumerate() {
        for col in 0..3 {
            if bits & (1 << (2 - col)) != 0 {
                for sy in 0..scale {
                    for sx in 0..scale {
                        let px = x + col * scale + sx;
                        let py = y + row as i32 * scale + sy;
                        if px >= 0 && py >= 0 && (px as u32) < w && (py as u32) < h {
                            img.put_pixel(px as u32, py as u32, color);
                        }
                    }
                }
            }
        }
    }
}

fn draw_number(img: &mut image::RgbImage, n: u32, x: i32, y: i32, scale: i32) {
    let s = n.to_string();
    let advance = 3 * scale + scale; // glyph width + 1-column gap
    let total_w = s.len() as i32 * advance;
    let total_h = 5 * scale;
    let (w, h) = img.dimensions();
    // Dark backing box for legibility.
    for by in (y - 1)..(y + total_h + 1) {
        for bx in (x - 1)..(x + total_w + 1) {
            if bx >= 0 && by >= 0 && (bx as u32) < w && (by as u32) < h {
                img.put_pixel(bx as u32, by as u32, image::Rgb([0, 0, 0]));
            }
        }
    }
    let mut cx = x;
    for ch in s.bytes() {
        draw_digit(img, ch - b'0', cx, y, scale, image::Rgb([255, 255, 0]));
        cx += advance;
    }
}

fn draw_coordinate_grid(img: &mut image::RgbImage) {
    let (w, h) = img.dimensions();
    let step: u32 = 200;
    let line = (120, 200, 255);
    let alpha = 0.28;

    let mut x = step;
    while x < w {
        for y in 0..h {
            blend_px(img.get_pixel_mut(x, y), line, alpha);
        }
        x += step;
    }
    let mut y = step;
    while y < h {
        for x2 in 0..w {
            blend_px(img.get_pixel_mut(x2, y), line, alpha);
        }
        y += step;
    }

    // Labels along the top edge (x) and left edge (y).
    let scale = 2;
    let mut x = step;
    while x < w {
        draw_number(img, x, x as i32 + 2, 2, scale);
        x += step;
    }
    let mut y = step;
    while y < h {
        draw_number(img, y, 2, y as i32 + 2, scale);
        y += step;
    }
}

/// Grid for a zoomed region. `(ox, oy)` is the screen coordinate of the crop's
/// top-left; `zoom` is how many image pixels equal one screen pixel. Every line
/// is labelled with its ABSOLUTE screen coordinate, so the model reads the exact
/// value to click.
fn draw_region_grid(img: &mut image::RgbImage, ox: i32, oy: i32, zoom: u32) {
    let (w, h) = img.dimensions();
    let line = (120, 200, 255);
    let alpha = 0.30;
    let step = 50i32; // screen px between labelled lines
    let z = zoom as i32;

    let mut sx = ((ox + step - 1) / step) * step;
    while ((sx - ox) * z) < w as i32 {
        let ix = (sx - ox) * z;
        if ix >= 0 {
            for y in 0..h {
                blend_px(img.get_pixel_mut(ix as u32, y), line, alpha);
            }
            draw_number(img, sx.max(0) as u32, ix + 2, 2, 2);
        }
        sx += step;
    }

    let mut sy = ((oy + step - 1) / step) * step;
    while ((sy - oy) * z) < h as i32 {
        let iy = (sy - oy) * z;
        if iy >= 0 {
            for x in 0..w {
                blend_px(img.get_pixel_mut(x, iy as u32), line, alpha);
            }
            draw_number(img, sy.max(0) as u32, 2, iy + 2, 2);
        }
        sy += step;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            return path.replacen("~", &home.to_string_lossy(), 1);
        }
    }
    path.to_string()
}
