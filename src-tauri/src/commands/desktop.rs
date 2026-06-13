use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    mpsc,
    Mutex,
    OnceLock,
};
use std::thread::{self, JoinHandle};

#[derive(Clone, Debug, Serialize)]
pub struct AgentDesktopInfo {
    pub id: u32,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct DesktopScreenshot {
    pub base64: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopWindowInfo {
    pub title: String,
    pub process_name: String,
    pub bounds: DesktopBounds,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopTarget {
    pub id: String,
    pub name: String,
    pub role: String,
    pub automation_id: Option<String>,
    pub bounds: DesktopBounds,
    pub enabled: bool,
    pub visible: bool,
    pub focused: bool,
    pub window_title: String,
    pub can_invoke: bool,
    pub can_scroll: bool,
    pub is_keyboard_focusable: bool,
    #[serde(default)]
    pub children_count: usize,
    #[serde(default)]
    pub precision_level: String,
    #[serde(default)]
    pub target_confidence: f32,
    #[serde(default)]
    pub click_strategy: String,
    #[serde(default)]
    pub is_large_container: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopReadResult {
    pub window: DesktopWindowInfo,
    pub targets: Vec<DesktopTarget>,
    #[serde(default)]
    pub snapshot_token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopReadDebugResult {
    pub success: bool,
    pub raw_stdout: String,
    pub raw_stderr: String,
    pub script: String,
    pub parsed: Option<DesktopReadResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopReadRegion {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopAppInfo {
    pub id: String,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub launch_kind: String,
    pub launch_target: String,
    pub install_source: String,
    pub score: f32,
    #[serde(default)]
    pub source_confidence: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopAppQueryResult {
    pub query: Option<String>,
    pub total: usize,
    pub apps: Vec<DesktopAppInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopResolvedPoint {
    pub anchor_x: i32,
    pub anchor_y: i32,
    pub confidence: f32,
    pub method: String,
    pub target_id: String,
    pub target_name: String,
    pub snapshot_token: String,
    pub window_title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopVisualCandidate {
    pub x: i32,
    pub y: i32,
    pub confidence: f32,
    pub method: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopVisualLocateResult {
    pub target_id: Option<String>,
    pub window_title: String,
    pub reason: String,
    pub confidence: f32,
    pub candidate_points: Vec<DesktopVisualCandidate>,
    pub next_region: Option<DesktopReadRegion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopFocusInfo {
    pub id: Option<String>,
    pub name: String,
    pub role: String,
    pub automation_id: Option<String>,
    pub window_title: String,
    pub can_invoke: bool,
    pub is_keyboard_focusable: bool,
    pub bounds: DesktopBounds,
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use base64::{engine::general_purpose, Engine as _};
    use image::codecs::jpeg::JpegEncoder;
    use image::{DynamicImage, RgbaImage};
    use std::ffi::OsStr;
    use std::mem::{size_of, zeroed};
    use std::path::Path;
    use std::process::Command;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::System::Threading::*;
    use windows_sys::Win32::System::StationsAndDesktops::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    use crate::commands::app_catalog::{match_known_app, LaunchCandidate};

    const DESKTOP_ALL_ACCESS: u32 = 0x000F01FF;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const SRCCOPY: u32 = 0x00CC0020;
    const CAPTUREBLT: u32 = 0x40000000;
    const BI_RGB: u32 = 0;
    const DIB_RGB_COLORS: u32 = 0;
    const HORZRES: i32 = 8;
    const VERTRES: i32 = 10;
    const SW_RESTORE: i32 = 9;

    #[derive(Copy, Clone)]
    struct DesktopHandle(HDESK);

    unsafe impl Send for DesktopHandle {}
    unsafe impl Sync for DesktopHandle {}

    enum DesktopRequest {
        Ping(mpsc::Sender<Result<(), String>>),
        Screenshot(mpsc::Sender<Result<DesktopScreenshot, String>>),
        MouseClick {
            x: i32,
            y: i32,
            button: Option<String>,
            resp: mpsc::Sender<Result<(), String>>,
        },
        MouseDoubleClick {
            x: i32,
            y: i32,
            resp: mpsc::Sender<Result<(), String>>,
        },
        MouseMove {
            x: i32,
            y: i32,
            resp: mpsc::Sender<Result<(), String>>,
        },
        MouseDrag {
            from_x: i32,
            from_y: i32,
            to_x: i32,
            to_y: i32,
            resp: mpsc::Sender<Result<(), String>>,
        },
        MouseScroll {
            x: i32,
            y: i32,
            direction: String,
            amount: i32,
            resp: mpsc::Sender<Result<(), String>>,
        },
        TypeText {
            text: String,
            resp: mpsc::Sender<Result<(), String>>,
        },
        KeyPress {
            key: String,
            resp: mpsc::Sender<Result<(), String>>,
        },
        KeyCombo {
            keys: Vec<String>,
            resp: mpsc::Sender<Result<(), String>>,
        },
        LaunchApp {
            command: String,
            resp: mpsc::Sender<Result<(), String>>,
        },
        GetScreenSize(mpsc::Sender<Result<(u32, u32), String>>),
        GetWindowList(mpsc::Sender<Result<Vec<String>, String>>),
        FocusWindow {
            title: String,
            resp: mpsc::Sender<Result<(), String>>,
        },
        Shutdown(mpsc::Sender<()>),
    }

    struct DesktopSession {
        id: u32,
        name: String,
        handle: DesktopHandle,
        sender: mpsc::Sender<DesktopRequest>,
        join_handle: Option<JoinHandle<()>>,
    }

    static SESSION: OnceLock<Mutex<Option<DesktopSession>>> = OnceLock::new();
    static NEXT_ID: AtomicU32 = AtomicU32::new(1);
    static NEXT_SNAPSHOT_ID: AtomicU32 = AtomicU32::new(1);
    static DESKTOP_TARGET_SNAPSHOT: OnceLock<Mutex<Option<DesktopReadResult>>> = OnceLock::new();

    fn session_store() -> &'static Mutex<Option<DesktopSession>> {
        SESSION.get_or_init(|| Mutex::new(None))
    }

    fn target_snapshot_store() -> &'static Mutex<Option<DesktopReadResult>> {
        DESKTOP_TARGET_SNAPSHOT.get_or_init(|| Mutex::new(None))
    }

    fn to_wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    fn to_wide_cmdline(value: &str) -> Vec<u16> {
        to_wide(value)
    }

    fn error_message(prefix: &str) -> String {
        let code = unsafe { GetLastError() };
        format!("{prefix} (Win32 error {code})")
    }

    fn powershell_run(script: &str) -> Result<(String, String), String> {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.success() {
            Ok((stdout, stderr))
        } else {
            Err(if stderr.is_empty() { stdout } else { stderr })
        }
    }

    fn powershell_json(script: &str) -> Result<String, String> {
        let (stdout, _) = powershell_run(script)?;
        if stdout.is_empty() {
            Err("PowerShell command returned no stdout".to_string())
        } else {
            Ok(stdout)
        }
    }

    fn quote_ps(value: &str) -> String {
        format!("'{}'", value.replace('\'', "''"))
    }

    fn normalize_text(value: &str) -> String {
        value
            .to_lowercase()
            .chars()
            .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn tokenize(value: &str) -> Vec<String> {
        normalize_text(value)
            .split_whitespace()
            .map(|part| part.to_string())
            .collect()
    }

    fn desktop_name(id: u32) -> String {
        format!("LarundAgentDesktop_{id}")
    }

    fn current_session_info(session: &DesktopSession) -> AgentDesktopInfo {
        AgentDesktopInfo {
            id: session.id,
            name: session.name.clone(),
        }
    }

    fn send_request<T>(
        sender: mpsc::Sender<DesktopRequest>,
        build: impl FnOnce(mpsc::Sender<Result<T, String>>) -> DesktopRequest,
    ) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        sender
            .send(build(tx))
            .map_err(|_| "Agent desktop worker is not available".to_string())?;
        rx.recv()
            .map_err(|_| "Agent desktop worker did not reply".to_string())?
    }

    fn desktop_read_script(limit: usize) -> String {
        format!(
            r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LarundNative {{
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}}
"@

$hwnd = [LarundNative]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {{
  throw 'No foreground window'
}}

$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $root) {{
  throw 'Failed to read the foreground window'
}}

function Convert-Bounds($rect) {{
  [pscustomobject]@{{
    x = [int][Math]::Round($rect.Left)
    y = [int][Math]::Round($rect.Top)
    width = [int][Math]::Round($rect.Width)
    height = [int][Math]::Round($rect.Height)
  }}
}}

function Convert-Target($element, $rootTitle, $index) {{
  $cur = $element.Current
  $rect = $cur.BoundingRectangle
  if ($cur.IsOffscreen) {{ return $null }}
  if ($rect.Width -lt 4 -or $rect.Height -lt 4) {{ return $null }}

  $role = if ($cur.ControlType -and $cur.ControlType.ProgrammaticName) {{
    $cur.ControlType.ProgrammaticName.Replace('ControlType.', '')
  }} else {{
    'Unknown'
  }}

  $name = [string]$cur.Name
  $aid = [string]$cur.AutomationId
  $focusable = $false
  try {{ $focusable = [bool]$cur.IsKeyboardFocusable }} catch {{}}
  $childrenCount = 0
  try {{
    $childrenCount = [int]$element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition).Count
  }} catch {{}}

  $interestingRole = @(
    'Button','MenuItem','TabItem','Edit','ComboBox','ListItem',
    'TreeItem','DataItem','CheckBox','RadioButton','Hyperlink',
    'SplitButton','Document','Pane','ToolBar'
  ) -contains $role

  if (-not $interestingRole -and -not $focusable -and [string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($aid)) {{
    return $null
  }}

  $runtimeId = ''
  try {{
    $runtime = $element.GetRuntimeId()
    if ($runtime) {{ $runtimeId = ($runtime | ForEach-Object {{ $_.ToString() }}) -join '.' }}
  }} catch {{}}
  if ([string]::IsNullOrWhiteSpace($runtimeId)) {{
    $runtimeId = '{fallback}:' + $index
  }}

  $canInvoke = $false
  try {{
    $null = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $canInvoke = $true
  }} catch {{}}

  $canScroll = $false
  try {{
    $null = $element.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    $canScroll = $true
  }} catch {{}}

  return [pscustomobject]@{{
    id = ('{prefix}|' + $runtimeId)
    name = [string]$name
    role = [string]$role
    automation_id = if ([string]::IsNullOrWhiteSpace($aid)) {{ $null }} else {{ [string]$aid }}
    bounds = Convert-Bounds $rect
    enabled = [bool]$cur.IsEnabled
    visible = -not [bool]$cur.IsOffscreen
    focused = [bool]$cur.HasKeyboardFocus
    window_title = [string]$rootTitle
    can_invoke = [bool]$canInvoke
    can_scroll = [bool]$canScroll
    is_keyboard_focusable = [bool]$focusable
    children_count = [int]$childrenCount
  }}
}}

$procName = ''
try {{
  $proc = Get-Process -Id $root.Current.ProcessId -ErrorAction Stop
  if ($proc) {{ $procName = $proc.ProcessName }}
}} catch {{}}

$rootBounds = $root.Current.BoundingRectangle
$targets = @()
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$max = [Math]::Min($all.Count, {limit})

for ($i = 0; $i -lt $max; $i++) {{
  $el = $all.Item($i)
  try {{
    $row = Convert-Target $el $root.Current.Name $i
    if ($null -ne $row) {{
      $targets += $row
    }}
  }} catch {{}}
}}

[pscustomobject]@{{
  window = [pscustomobject]@{{
    title = [string]$root.Current.Name
    process_name = $procName
    bounds = Convert-Bounds $rootBounds
  }}
  targets = @($targets)
}} | ConvertTo-Json -Depth 6 -Compress
"#,
            limit = limit,
            prefix = "fg",
            fallback = "idx"
        )
    }

    fn is_target_in_region(bounds: &DesktopBounds, region: &DesktopReadRegion) -> bool {
        let right = bounds.x + bounds.width;
        let bottom = bounds.y + bounds.height;
        let region_right = region.x + region.width;
        let region_bottom = region.y + region.height;
        bounds.x < region_right
            && right > region.x
            && bounds.y < region_bottom
            && bottom > region.y
    }

    fn infer_click_strategy(target: &DesktopTarget) -> String {
        let role = target.role.to_lowercase();
        if target.can_invoke && !target.is_large_container {
            return "invoke".to_string();
        }
        if role.contains("checkbox") || role.contains("radio") {
            return "left_glyph".to_string();
        }
        if role.contains("toolbar") || role.contains("splitbutton") {
            return "toolbar_multi_anchor".to_string();
        }
        if target.is_large_container || target.children_count >= 8 {
            return "visual_refine".to_string();
        }
        "safe_inset".to_string()
    }

    fn infer_precision_metadata(target: &mut DesktopTarget) {
        let area = (target.bounds.width.max(1) * target.bounds.height.max(1)) as f32;
        let role = target.role.to_lowercase();
        target.is_large_container = area > 55_000.0
            || target.bounds.width > 280
            || target.bounds.height > 140
            || target.children_count >= 8
            || role.contains("pane")
            || role.contains("document");

        let mut confidence = 0.35f32;
        if !target.name.trim().is_empty() {
            confidence += 0.15;
        }
        if target.automation_id.as_ref().is_some_and(|id| !id.trim().is_empty()) {
            confidence += 0.10;
        }
        if target.can_invoke {
            confidence += 0.15;
        }
        if !target.is_large_container {
            confidence += 0.15;
        }
        if area < 18_000.0 {
            confidence += 0.10;
        }
        if role.contains("button")
            || role.contains("menuitem")
            || role.contains("checkbox")
            || role.contains("radio")
            || role.contains("tabitem")
            || role.contains("listitem")
        {
            confidence += 0.10;
        }
        if target.children_count >= 10 {
            confidence -= 0.15;
        }

        target.target_confidence = confidence.clamp(0.05, 0.98);
        target.click_strategy = infer_click_strategy(target);
        target.precision_level = if target.target_confidence >= 0.78 && target.click_strategy != "visual_refine" {
            "high".to_string()
        } else if target.target_confidence >= 0.58 {
            "medium".to_string()
        } else {
            "low".to_string()
        };
    }

    fn read_desktop_snapshot(
        mode: Option<String>,
        region: Option<DesktopReadRegion>,
    ) -> Result<DesktopReadResult, String> {
        let raw = powershell_json(&desktop_read_script(220))?;
        let mut result = serde_json::from_str::<DesktopReadResult>(&raw)
            .map_err(|e| format!("Failed to parse desktop UI snapshot: {}", e))?;

        if let Some(region) = region.as_ref() {
            result.targets.retain(|target| is_target_in_region(&target.bounds, region));
        }

        for target in &mut result.targets {
            infer_precision_metadata(target);
        }

        if mode.as_deref() == Some("precision") {
            result.targets.sort_by(|a, b| {
                b.target_confidence
                    .partial_cmp(&a.target_confidence)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(a.bounds.width.cmp(&b.bounds.width))
                    .then(a.bounds.height.cmp(&b.bounds.height))
            });
        }

        result.snapshot_token = format!(
            "desktop-snapshot-{}",
            NEXT_SNAPSHOT_ID.fetch_add(1, Ordering::SeqCst)
        );
        Ok(result)
    }

    fn current_safe_point(bounds: &DesktopBounds) -> (i32, i32) {
        let inset_x = (bounds.width / 6).clamp(4, 18);
        let inset_y = (bounds.height / 6).clamp(4, 18);
        let min_x = bounds.x + inset_x;
        let max_x = bounds.x + bounds.width - inset_x;
        let min_y = bounds.y + inset_y;
        let max_y = bounds.y + bounds.height - inset_y;
        let cx = bounds.x + bounds.width / 2;
        let cy = bounds.y + bounds.height / 2;
        (cx.clamp(min_x, max_x.max(min_x)), cy.clamp(min_y, max_y.max(min_y)))
    }

    fn resolve_visual_anchor(target: &DesktopTarget) -> DesktopResolvedPoint {
        let bounds = &target.bounds;
        let mut x = bounds.x + bounds.width / 2;
        let mut y = bounds.y + bounds.height / 2;
        let method = match target.click_strategy.as_str() {
            "left_glyph" => {
                x = bounds.x + (bounds.width / 4).clamp(6, 18);
                "left_glyph"
            }
            "toolbar_multi_anchor" => {
                let max_x = bounds.width.saturating_sub(8).max(8);
                let max_y = bounds.height.saturating_sub(6).max(6);
                x = bounds.x + (bounds.width / 2).clamp(8, max_x);
                y = bounds.y + (bounds.height / 2).clamp(6, max_y);
                "toolbar_multi_anchor"
            }
            "invoke" => "invoke_center",
            "visual_refine" => {
                let (safe_x, safe_y) = current_safe_point(bounds);
                x = safe_x;
                y = safe_y;
                "visual_refine"
            }
            _ => {
                let (safe_x, safe_y) = current_safe_point(bounds);
                x = safe_x;
                y = safe_y;
                "safe_inset"
            }
        };

        DesktopResolvedPoint {
            anchor_x: x,
            anchor_y: y,
            confidence: target.target_confidence,
            method: method.to_string(),
            target_id: target.id.clone(),
            target_name: target.name.clone(),
            snapshot_token: String::new(),
            window_title: target.window_title.clone(),
        }
    }

    fn resolve_target(id: &str, snapshot_token: &str) -> Result<(DesktopReadResult, DesktopTarget), String> {
        let snapshot = target_snapshot_store()
            .lock()
            .map_err(|_| "Desktop target snapshot lock poisoned".to_string())?
            .clone()
            .ok_or_else(|| "No desktop target snapshot available. Call desktop_read first.".to_string())?;

        if snapshot.snapshot_token != snapshot_token {
            return Err("stale_target: snapshot token no longer matches the current desktop snapshot. Call desktop_read again.".to_string());
        }

        let current = read_desktop_snapshot(Some("semantic".to_string()), None)?;
        if current.window.title != snapshot.window.title
            || current.window.process_name != snapshot.window.process_name
        {
            return Err("window_changed: Desktop UI changed since desktop_read. Call desktop_read again.".to_string());
        }

        let target = current
            .targets
            .iter()
            .find(|target| target.id == id)
            .cloned()
            .ok_or_else(|| "stale_target: target is stale or no longer visible. Call desktop_read again.".to_string())?;

        if !target.visible {
            return Err("target_offscreen: target is off-screen. Call desktop_read again after bringing it into view.".to_string());
        }
        if !target.enabled {
            return Err("target_disabled: target is disabled and cannot be activated.".to_string());
        }
        Ok((current, target))
    }

    fn desktop_pattern_action(id: &str, action: &str, extra: Option<&str>) -> Result<String, String> {
        let quoted_id = quote_ps(id);
        let extra_clause = extra.unwrap_or("");
        let script = format!(
            r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LarundNative {{
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}}
"@

$targetId = {target_id}
$hwnd = [LarundNative]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {{ throw 'No foreground window' }}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $root) {{ throw 'Failed to read the foreground window' }}
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
for ($i = 0; $i -lt $all.Count; $i++) {{
  $el = $all.Item($i)
  try {{
    $runtime = ''
    try {{
      $rid = $el.GetRuntimeId()
      if ($rid) {{ $runtime = ($rid | ForEach-Object {{ $_.ToString() }}) -join '.' }}
    }} catch {{}}
    $candidateId = 'fg|' + $(if ([string]::IsNullOrWhiteSpace($runtime)) {{ 'idx:' + $i }} else {{ $runtime }})
    if ($candidateId -eq $targetId) {{
      $target = $el
      break
    }}
  }} catch {{}}
}}
if ($null -eq $target) {{ throw 'Target is stale or no longer present' }}
{extra_clause}
switch ({action_name}) {{
  'invoke' {{
    $pattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($null -eq $pattern) {{ throw 'InvokePattern is not available' }}
    $pattern.Invoke()
  }}
  'focus' {{
    $target.SetFocus()
  }}
  'scroll_up' {{
    $pattern = $target.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    if ($null -eq $pattern) {{ throw 'ScrollPattern is not available' }}
    $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::SmallDecrement)
  }}
  'scroll_down' {{
    $pattern = $target.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    if ($null -eq $pattern) {{ throw 'ScrollPattern is not available' }}
    $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::SmallIncrement)
  }}
  default {{
    throw 'Unknown desktop pattern action'
  }}
}}
'ok'
"#,
            target_id = quoted_id,
            action_name = quote_ps(action),
            extra_clause = extra_clause
        );
        powershell_json(&script)
    }

    fn desktop_focus_read_script() -> String {
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LarundNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@

function Convert-Bounds($rect) {
  [pscustomobject]@{
    x = [int][Math]::Round($rect.Left)
    y = [int][Math]::Round($rect.Top)
    width = [int][Math]::Round($rect.Width)
    height = [int][Math]::Round($rect.Height)
  }
}

$hwnd = [LarundNative]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { throw 'No foreground window' }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $root) { throw 'Failed to read foreground window' }
$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) { throw 'No focused element' }

$runtimeId = $null
try {
  $rid = $focused.GetRuntimeId()
  if ($rid) { $runtimeId = 'fg|' + (($rid | ForEach-Object { $_.ToString() }) -join '.') }
} catch {}

$canInvoke = $false
try {
  $null = $focused.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $canInvoke = $true
} catch {}

[pscustomobject]@{
  id = $runtimeId
  name = [string]$focused.Current.Name
  role = if ($focused.Current.ControlType -and $focused.Current.ControlType.ProgrammaticName) { [string]$focused.Current.ControlType.ProgrammaticName.Replace('ControlType.', '') } else { 'Unknown' }
  automation_id = if ([string]::IsNullOrWhiteSpace([string]$focused.Current.AutomationId)) { $null } else { [string]$focused.Current.AutomationId }
  window_title = [string]$root.Current.Name
  can_invoke = [bool]$canInvoke
  is_keyboard_focusable = [bool]$focused.Current.IsKeyboardFocusable
  bounds = Convert-Bounds $focused.Current.BoundingRectangle
} | ConvertTo-Json -Depth 4 -Compress
"#
        .to_string()
    }

    fn read_focused_element() -> Result<DesktopFocusInfo, String> {
        let raw = powershell_json(&desktop_focus_read_script())?;
        serde_json::from_str::<DesktopFocusInfo>(&raw)
            .map_err(|e| format!("Failed to parse focused element: {e}"))
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
        let titles = &mut *(lparam as *mut Vec<String>);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return 1;
        }
        let mut buf = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if copied > 0 {
            let title = String::from_utf16_lossy(&buf[..copied as usize])
                .trim()
                .to_string();
            if !title.is_empty() {
                titles.push(title);
            }
        }
        1
    }

    unsafe fn capture_desktop_screenshot() -> Result<DesktopScreenshot, String> {
        let hdc_screen = GetDC(null_mut());
        if hdc_screen == null_mut() {
            return Err(error_message("Failed to get desktop DC"));
        }

        let width = GetDeviceCaps(hdc_screen, HORZRES);
        let height = GetDeviceCaps(hdc_screen, VERTRES);
        if width <= 0 || height <= 0 {
            ReleaseDC(null_mut(), hdc_screen);
            return Err("Desktop size is invalid".to_string());
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem == null_mut() {
            ReleaseDC(null_mut(), hdc_screen);
            return Err(error_message("Failed to create memory DC"));
        }

        let hbmp = CreateCompatibleBitmap(hdc_screen, width, height);
        if hbmp == null_mut() {
            DeleteDC(hdc_mem);
            ReleaseDC(null_mut(), hdc_screen);
            return Err(error_message("Failed to create bitmap"));
        }

        let old_obj = SelectObject(hdc_mem, hbmp as HGDIOBJ);
        let ok = BitBlt(
            hdc_mem,
            0,
            0,
            width,
            height,
            hdc_screen,
            0,
            0,
            SRCCOPY | CAPTUREBLT,
        );
        if ok == 0 {
            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbmp as HGDIOBJ);
            DeleteDC(hdc_mem);
            ReleaseDC(null_mut(), hdc_screen);
            return Err(error_message("Failed to copy desktop pixels"));
        }

        let mut bmi: BITMAPINFO = zeroed();
        bmi.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let scan_lines = GetDIBits(
            hdc_mem,
            hbmp,
            0,
            height as u32,
            pixels.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old_obj);
        DeleteObject(hbmp as HGDIOBJ);
        DeleteDC(hdc_mem);
        ReleaseDC(null_mut(), hdc_screen);

        if scan_lines == 0 {
            return Err(error_message("Failed to read desktop pixels"));
        }

        let image = RgbaImage::from_raw(width as u32, height as u32, pixels)
            .ok_or_else(|| "Failed to build image buffer".to_string())?;
        let rgb = DynamicImage::ImageRgba8(image).to_rgb8();
        let mut encoded = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut encoded);
            let encoder = JpegEncoder::new_with_quality(&mut cursor, 80);
            DynamicImage::ImageRgb8(rgb)
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
        }

        Ok(DesktopScreenshot {
            base64: general_purpose::STANDARD.encode(encoded),
            width: width as u32,
            height: height as u32,
        })
    }

    unsafe fn launch_on_desktop(desktop_name: &str, launch_command: &str) -> Result<(), String> {
        let command = format!("cmd.exe /C start \"\" {}", launch_command);
        let mut command_w = to_wide_cmdline(&command);
        let desktop_w = to_wide(desktop_name);
        let mut startup: STARTUPINFOW = zeroed();
        startup.cb = size_of::<STARTUPINFOW>() as u32;
        startup.lpDesktop = desktop_w.as_ptr() as *mut u16;

        let mut process_info: PROCESS_INFORMATION = zeroed();
        let ok = CreateProcessW(
            null(),
            command_w.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_NO_WINDOW,
            null(),
            null(),
            &mut startup,
            &mut process_info,
        );

        if ok == 0 {
            return Err(error_message("Failed to launch app on agent desktop"));
        }

        if process_info.hProcess != null_mut() {
            CloseHandle(process_info.hProcess);
        }
        if process_info.hThread != null_mut() {
            CloseHandle(process_info.hThread);
        }
        Ok(())
    }

    fn quote_cmd(value: &str) -> String {
        if value.contains(' ') || value.contains('"') {
            format!("\"{}\"", value.replace('"', "\\\""))
        } else {
            value.to_string()
        }
    }

    fn desktop_apps_script() -> &'static str {
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$items = New-Object System.Collections.Generic.List[object]
$seen = @{}

function Add-AppItem {
  param(
    [string]$Name,
    [string]$LaunchKind,
    [string]$LaunchTarget,
    [string]$InstallSource,
    [string[]]$Aliases
  )
  if ([string]::IsNullOrWhiteSpace($Name) -or [string]::IsNullOrWhiteSpace($LaunchTarget)) { return }
  $key = ($Name.Trim().ToLowerInvariant() + '|' + $LaunchKind + '|' + $LaunchTarget.Trim().ToLowerInvariant())
  if ($seen.ContainsKey($key)) { return }
  $seen[$key] = $true
  $items.Add([pscustomobject]@{
    id = $key
    display_name = $Name.Trim()
    aliases = @($Aliases | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    launch_kind = $LaunchKind
    launch_target = $LaunchTarget.Trim()
    install_source = $InstallSource
    score = 0
  })
}

$startPaths = @(
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs"
) | Where-Object { $_ -and (Test-Path $_) }

foreach ($root in $startPaths) {
  Get-ChildItem -Path $root -Filter *.lnk -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    Add-AppItem -Name $base -LaunchKind 'shortcut' -LaunchTarget $_.FullName -InstallSource 'start_menu_shortcut' -Aliases @($base, $_.Directory.Name)
  }
}

try {
  Get-StartApps | ForEach-Object {
    $name = $_.Name
    $appId = $_.AppID
    Add-AppItem -Name $name -LaunchKind 'appx' -LaunchTarget $appId -InstallSource 'start_apps' -Aliases @($name)
  }
} catch {}

$uninstallRoots = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

foreach ($root in $uninstallRoots) {
  Get-ItemProperty $root -ErrorAction SilentlyContinue | ForEach-Object {
    $name = $_.DisplayName
    if ([string]::IsNullOrWhiteSpace($name)) { return }
    $target = $null
    $kind = $null
    if ($_.DisplayIcon -and (Test-Path $_.DisplayIcon)) {
      $target = $_.DisplayIcon
      $kind = 'exe'
    } elseif ($_.InstallLocation -and (Test-Path $_.InstallLocation)) {
      $candidate = Get-ChildItem -Path $_.InstallLocation -Filter *.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($candidate) {
        $target = $candidate.FullName
        $kind = 'exe'
      }
    }
    if ($target -and $kind) {
      Add-AppItem -Name $name -LaunchKind $kind -LaunchTarget $target -InstallSource 'uninstall_registry' -Aliases @($name, $_.QuietDisplayName, $_.InstallLocation)
    }
  }
}

$commonRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path $_) }
foreach ($root in $commonRoots) {
  Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue | Select-Object -First 120 | ForEach-Object {
    $exe = Get-ChildItem -Path $_.FullName -Filter *.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) {
      $base = [System.IO.Path]::GetFileNameWithoutExtension($exe.Name)
      Add-AppItem -Name $_.Name -LaunchKind 'exe' -LaunchTarget $exe.FullName -InstallSource 'common_install_path' -Aliases @($_.Name, $base)
    }
  }
}

$items | ConvertTo-Json -Depth 6 -Compress
"#
    }

    fn list_installed_apps() -> Result<Vec<DesktopAppInfo>, String> {
        // Never hard-fail the inventory: if PowerShell errors or returns nothing
        // parseable, fall back to an empty list rather than surfacing an error to
        // the user. A single-object result (ConvertTo-Json with one item) is also
        // accepted.
        let raw = powershell_run(desktop_apps_script())
            .map(|(stdout, _)| stdout)
            .unwrap_or_default();
        let mut apps = if raw.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str::<Vec<DesktopAppInfo>>(&raw)
                .or_else(|_| serde_json::from_str::<DesktopAppInfo>(&raw).map(|item| vec![item]))
                .unwrap_or_default()
        };

        for app in &mut apps {
            let mut aliases = app.aliases.clone();
            aliases.push(app.display_name.clone());
            if let Some(stem) = Path::new(&app.launch_target).file_stem() {
                aliases.push(stem.to_string_lossy().to_string());
            }
            let normalized_display = normalize_text(&app.display_name);
            if normalized_display.contains("libre office") {
                aliases.push("libreoffice".to_string());
                aliases.push("libreoffice calc".to_string());
            }
            if normalized_display.contains("calc") {
                aliases.push("spreadsheet".to_string());
            }
            aliases = aliases
                .into_iter()
                .map(|alias| alias.trim().to_string())
                .filter(|alias| !alias.is_empty())
                .collect();
            aliases.sort();
            aliases.dedup();
            app.aliases = aliases;
            app.source_confidence = match app.install_source.as_str() {
                "start_apps" => 1.0,
                "start_menu_shortcut" => 0.95,
                "common_install_path" => 0.8,
                "uninstall_registry" => 0.45,
                _ => 0.35,
            };
        }

        apps.retain(|app| {
            if app.launch_kind == "exe" {
                let path_ok = app.launch_target.to_ascii_lowercase().ends_with(".exe");
                path_ok && Path::new(&app.launch_target).exists()
            } else if app.launch_kind == "shortcut" {
                app.launch_target.to_ascii_lowercase().ends_with(".lnk")
            } else if app.launch_kind == "appx" {
                !app.launch_target.trim().is_empty()
            } else {
                !app.launch_target.trim().is_empty()
            }
        });

        apps.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
        Ok(apps)
    }

    fn score_app_match(query: &str, app: &DesktopAppInfo) -> f32 {
        let normalized_query = normalize_text(query);
        let query_tokens = tokenize(query);
        if normalized_query.is_empty() {
            return 0.0;
        }

        let mut best = 0.0f32;
        for candidate in std::iter::once(&app.display_name).chain(app.aliases.iter()) {
            let normalized_candidate = normalize_text(candidate);
            if normalized_candidate.is_empty() {
                continue;
            }

            let mut score = 0.0f32;
            if normalized_candidate == normalized_query {
                score += 1.35;
            } else if normalized_candidate.starts_with(&normalized_query) {
                score += 1.10;
            } else if normalized_candidate.contains(&normalized_query) {
                score += 0.92;
            }

            let candidate_tokens = tokenize(candidate);
            if !candidate_tokens.is_empty() {
                let overlap = query_tokens
                    .iter()
                    .filter(|token| candidate_tokens.iter().any(|candidate| candidate == *token))
                    .count() as f32
                    / query_tokens.len().max(1) as f32;
                score += overlap * 0.75;
            }

            if query_tokens.len() == 1 && candidate_tokens.iter().any(|token| token == &query_tokens[0]) {
                score += 0.18;
            }

            score += app.source_confidence * 0.18;
            best = best.max(score);
        }

        best.clamp(0.0, 1.9)
    }

    fn query_desktop_apps(query: Option<&str>, limit: Option<usize>) -> Result<DesktopAppQueryResult, String> {
        let mut apps = list_installed_apps()?;
        let query = query.map(|value| value.trim()).filter(|value| !value.is_empty()).map(|value| value.to_string());
        if let Some(query_value) = query.as_ref() {
            for app in &mut apps {
                app.score = score_app_match(query_value, app);
            }
            apps.retain(|app| app.score >= 0.30);
            apps.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| b.source_confidence.partial_cmp(&a.source_confidence).unwrap_or(std::cmp::Ordering::Equal))
                    .then_with(|| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()))
            });
        }
        let total = apps.len();
        let apps = apps.into_iter().take(limit.unwrap_or(20).clamp(1, 100)).collect();
        Ok(DesktopAppQueryResult { query, total, apps })
    }

    fn resolve_desktop_app(query: &str, app_id: Option<&str>) -> Result<DesktopAppInfo, String> {
        if let Some(app_id) = app_id {
            let apps = list_installed_apps()?;
            if let Some(app) = apps.into_iter().find(|app| app.id == app_id) {
                return Ok(app);
            }
            return Err(format!("app_not_found: no desktop app found for id {app_id}"));
        }

        let mut apps = list_installed_apps()?;
        for app in &mut apps {
            app.score = score_app_match(query, app);
        }
        apps.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.source_confidence.partial_cmp(&a.source_confidence).unwrap_or(std::cmp::Ordering::Equal))
        });

        let Some(best) = apps.first().cloned() else {
            return Err("app_inventory_empty: no installed apps were discovered".to_string());
        };

        let runner_up = apps.get(1).cloned();
        // Accept a clearly dominant, reasonably confident match. Only report
        // ambiguity when the top two candidates are genuinely close — this keeps the
        // fallback path from failing on the first try for ordinary apps (the curated
        // catalog already handles the common ones deterministically upstream).
        if best.score < 0.55 {
            let top = apps.into_iter().take(5).collect::<Vec<_>>();
            return Err(format!(
                "ambiguous_app_match:{}",
                serde_json::to_string(&top).unwrap_or_else(|_| "[]".to_string())
            ));
        }

        if let Some(next) = runner_up {
            if next.score >= 0.55 && (best.score - next.score) < 0.12 {
                return Err(format!(
                    "ambiguous_app_match:{}",
                    serde_json::to_string(&vec![best, next]).unwrap_or_else(|_| "[]".to_string())
                ));
            }
        }

        Ok(best)
    }

    fn mouse_click_impl(x: i32, y: i32, button: Option<String>) -> Result<(), String> {
        use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        let btn = match button.as_deref() {
            Some("right") => Button::Right,
            Some("middle") => Button::Middle,
            _ => Button::Left,
        };
        enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        enigo.button(btn, Direction::Click).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn mouse_double_click_impl(x: i32, y: i32) -> Result<(), String> {
        use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(80));
        enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn mouse_move_impl(x: i32, y: i32) -> Result<(), String> {
        use enigo::{Coordinate, Enigo, Mouse, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn mouse_drag_impl(from_x: i32, from_y: i32, to_x: i32, to_y: i32) -> Result<(), String> {
        use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo.move_mouse(from_x, from_y, Coordinate::Abs).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(60));
        enigo.button(Button::Left, Direction::Press).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(60));
        enigo.move_mouse(to_x, to_y, Coordinate::Abs).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(60));
        enigo.button(Button::Left, Direction::Release).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn mouse_scroll_impl(x: i32, y: i32, direction: String, amount: i32) -> Result<(), String> {
        use enigo::{Axis, Coordinate, Enigo, Mouse, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
        let (axis, delta) = match direction.as_str() {
            "up" => (Axis::Vertical, amount),
            "down" => (Axis::Vertical, -amount),
            "left" => (Axis::Horizontal, -amount),
            "right" => (Axis::Horizontal, amount),
            _ => (Axis::Vertical, -amount),
        };
        enigo.scroll(delta, axis).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn type_text_impl(text: &str) -> Result<(), String> {
        use enigo::{Enigo, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(100));
        enigo.text(text).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn key_press_impl(key: &str) -> Result<(), String> {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        let k = match key.to_lowercase().as_str() {
            "enter" | "return" => Key::Return,
            "tab" => Key::Tab,
            "escape" | "esc" => Key::Escape,
            "backspace" => Key::Backspace,
            "delete" | "del" => Key::Delete,
            "space" => Key::Space,
            "up" => Key::UpArrow,
            "down" => Key::DownArrow,
            "left" => Key::LeftArrow,
            "right" => Key::RightArrow,
            "home" => Key::Home,
            "end" => Key::End,
            "pageup" => Key::PageUp,
            "pagedown" => Key::PageDown,
            "f1" => Key::F1,
            "f2" => Key::F2,
            "f3" => Key::F3,
            "f4" => Key::F4,
            "f5" => Key::F5,
            "f6" => Key::F6,
            "f7" => Key::F7,
            "f8" => Key::F8,
            "f9" => Key::F9,
            "f10" => Key::F10,
            "f11" => Key::F11,
            "f12" => Key::F12,
            _ => Key::Unicode(key.chars().next().unwrap_or(' ')),
        };
        enigo.key(k, Direction::Click).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn key_combo_impl(keys: &[String]) -> Result<(), String> {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

        fn str_to_key(s: &str) -> Option<Key> {
            match s.to_lowercase().as_str() {
                "ctrl" | "control" => Some(Key::Control),
                "alt" => Some(Key::Alt),
                "shift" => Some(Key::Shift),
                "win" | "meta" => Some(Key::Meta),
                "enter" => Some(Key::Return),
                "tab" => Some(Key::Tab),
                "esc" | "escape" => Some(Key::Escape),
                "space" => Some(Key::Space),
                s if s.len() == 1 => s.chars().next().map(Key::Unicode),
                _ => None,
            }
        }

        let parsed: Vec<Key> = keys.iter().filter_map(|k| str_to_key(k)).collect();
        for k in &parsed {
            enigo.key(*k, Direction::Press).map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        for k in parsed.iter().rev() {
            enigo.key(*k, Direction::Release).map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        Ok(())
    }

    unsafe fn find_window_by_title(desktop_handle: HDESK, title: &str) -> Result<Option<HWND>, String> {
        struct FindCtx {
            query: String,
            found: Option<HWND>,
        }

        unsafe extern "system" fn find_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
            let ctx = &mut *(lparam as *mut FindCtx);
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let len = GetWindowTextLengthW(hwnd);
            if len <= 0 {
                return 1;
            }
            let mut buf = vec![0u16; len as usize + 1];
            let copied = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if copied > 0 {
                let window_title = String::from_utf16_lossy(&buf[..copied as usize]);
                if window_title.to_lowercase().contains(&ctx.query) {
                    ctx.found = Some(hwnd);
                    return 0;
                }
            }
            1
        }

        let mut ctx = FindCtx {
            query: title.to_lowercase(),
            found: None,
        };
        let enum_ok = EnumDesktopWindows(
            desktop_handle,
            Some(find_proc),
            &mut ctx as *mut _ as LPARAM,
        );
        if enum_ok == 0 {
            return Err(error_message("Failed to search agent windows"));
        }

        Ok(ctx.found)
    }

    unsafe fn focus_window_on_agent_desktop(desktop_handle: HDESK, title: &str) -> Result<(), String> {
        let hwnd = find_window_by_title(desktop_handle, title)?
            .ok_or_else(|| format!("Window not found on agent desktop: {title}"))?;
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        Ok(())
    }

    fn worker_loop(desktop_handle: DesktopHandle, desktop_name: String, rx: mpsc::Receiver<DesktopRequest>) {
        unsafe {
            if SetThreadDesktop(desktop_handle.0) == 0 {
                eprintln!("[DESKTOP] SetThreadDesktop failed: {}", GetLastError());
                return;
            }
        }

        while let Ok(request) = rx.recv() {
            match request {
                DesktopRequest::Ping(resp) => {
                    let _ = resp.send(Ok(()));
                }
                DesktopRequest::Screenshot(resp) => {
                    let result = unsafe { capture_desktop_screenshot() };
                    let _ = resp.send(result);
                }
                DesktopRequest::MouseClick { x, y, button, resp } => {
                    let result = mouse_click_impl(x, y, button);
                    let _ = resp.send(result);
                }
                DesktopRequest::MouseDoubleClick { x, y, resp } => {
                    let result = mouse_double_click_impl(x, y);
                    let _ = resp.send(result);
                }
                DesktopRequest::MouseMove { x, y, resp } => {
                    let result = mouse_move_impl(x, y);
                    let _ = resp.send(result);
                }
                DesktopRequest::MouseDrag { from_x, from_y, to_x, to_y, resp } => {
                    let result = mouse_drag_impl(from_x, from_y, to_x, to_y);
                    let _ = resp.send(result);
                }
                DesktopRequest::MouseScroll { x, y, direction, amount, resp } => {
                    let result = mouse_scroll_impl(x, y, direction, amount);
                    let _ = resp.send(result);
                }
                DesktopRequest::TypeText { text, resp } => {
                    let result = type_text_impl(&text);
                    let _ = resp.send(result);
                }
                DesktopRequest::KeyPress { key, resp } => {
                    let result = key_press_impl(&key);
                    let _ = resp.send(result);
                }
                DesktopRequest::KeyCombo { keys, resp } => {
                    let result = key_combo_impl(&keys);
                    let _ = resp.send(result);
                }
                DesktopRequest::LaunchApp { command, resp } => {
                    let result = unsafe { launch_on_desktop(&desktop_name, &command) };
                    let _ = resp.send(result);
                }
                DesktopRequest::GetScreenSize(resp) => {
                    let result = unsafe { get_screen_size_impl() };
                    let _ = resp.send(result);
                }
                DesktopRequest::GetWindowList(resp) => {
                    let result = unsafe { get_window_list_impl(desktop_handle.0) };
                    let _ = resp.send(result);
                }
                DesktopRequest::FocusWindow { title, resp } => {
                    let result = unsafe { focus_window_on_agent_desktop(desktop_handle.0, &title) };
                    let _ = resp.send(result);
                }
                DesktopRequest::Shutdown(resp) => {
                    let _ = resp.send(());
                    break;
                }
            }
        }
    }

    unsafe fn get_screen_size_impl() -> Result<(u32, u32), String> {
        let hdc = GetDC(null_mut());
        if hdc == null_mut() {
            return Err(error_message("Failed to read desktop size"));
        }
        let width = GetDeviceCaps(hdc, HORZRES);
        let height = GetDeviceCaps(hdc, VERTRES);
        ReleaseDC(null_mut(), hdc);
        if width <= 0 || height <= 0 {
            return Err("Desktop size is invalid".to_string());
        }
        Ok((width as u32, height as u32))
    }

    unsafe fn get_window_list_impl(desktop_handle: HDESK) -> Result<Vec<String>, String> {
        let mut titles: Vec<String> = Vec::new();
        let ok = EnumDesktopWindows(
            desktop_handle,
            Some(enum_windows_proc),
            &mut titles as *mut _ as LPARAM,
        );
        if ok == 0 {
            return Err(error_message("Failed to enumerate desktop windows"));
        }
        Ok(titles)
    }

    fn ping_session(session: &DesktopSession) -> bool {
        let (tx, rx) = mpsc::channel();
        if session.sender.send(DesktopRequest::Ping(tx)).is_err() {
            return false;
        }
        matches!(rx.recv(), Ok(Ok(())))
    }

    pub fn active_agent_desktop() -> Option<AgentDesktopInfo> {
        let guard = session_store().lock().ok()?;
        let session = guard.as_ref()?;
        Some(current_session_info(session))
    }

    pub fn create_agent_desktop() -> Result<AgentDesktopInfo, String> {
        {
            let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
            if let Some(session) = guard.as_ref() {
                if ping_session(session) {
                    return Ok(current_session_info(session));
                }
            }
        }

        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        let name = desktop_name(id);
        let desktop_w = to_wide(&name);

        let handle = unsafe {
            CreateDesktopW(
                desktop_w.as_ptr(),
                null(),
                null(),
                0,
                DESKTOP_ALL_ACCESS,
                null(),
            )
        };

        if handle == null_mut() {
            return Err(error_message("Failed to create agent desktop"));
        }

        let (tx, rx) = mpsc::channel();
        let worker_handle = DesktopHandle(handle);
        let worker_name = name.clone();
        let join_handle = thread::spawn(move || worker_loop(worker_handle, worker_name, rx));

        let session = DesktopSession {
            id,
            name: name.clone(),
            handle: DesktopHandle(handle),
            sender: tx,
            join_handle: Some(join_handle),
        };

        let mut guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        *guard = Some(session);

        Ok(AgentDesktopInfo { id, name })
    }

    pub fn close_agent_desktop(id: u32) -> Result<(), String> {
        let session = {
            let mut guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
            match guard.as_ref() {
                Some(existing) if existing.id == id => guard.take(),
                _ => None,
            }
        };

        let Some(mut session) = session else {
            return Ok(());
        };

        let (tx, rx) = mpsc::channel();
        let _ = session.sender.send(DesktopRequest::Shutdown(tx));
        let _ = rx.recv();

        if let Some(join_handle) = session.join_handle.take() {
            let _ = join_handle.join();
        }

        unsafe {
            CloseDesktop(session.handle.0);
        }

        Ok(())
    }

    pub fn agent_screenshot() -> Result<DesktopScreenshot, String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, DesktopRequest::Screenshot)
    }

    pub fn agent_mouse_click(x: i32, y: i32, button: Option<String>) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::MouseClick { x, y, button, resp })?;
        Ok(())
    }

    pub fn agent_mouse_double_click(x: i32, y: i32) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::MouseDoubleClick { x, y, resp })?;
        Ok(())
    }

    pub fn agent_mouse_move(x: i32, y: i32) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::MouseMove { x, y, resp })?;
        Ok(())
    }

    pub fn agent_mouse_drag(from_x: i32, from_y: i32, to_x: i32, to_y: i32) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::MouseDrag {
            from_x,
            from_y,
            to_x,
            to_y,
            resp,
        })?;
        Ok(())
    }

    pub fn agent_mouse_scroll(x: i32, y: i32, direction: String, amount: i32) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::MouseScroll {
            x,
            y,
            direction,
            amount,
            resp,
        })?;
        Ok(())
    }

    pub fn agent_type_text(text: String) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::TypeText { text, resp })?;
        Ok(())
    }

    pub fn agent_key_press(key: String) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::KeyPress { key, resp })?;
        Ok(())
    }

    pub fn agent_key_combo(keys: Vec<String>) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::KeyCombo { keys, resp })?;
        Ok(())
    }

    pub fn agent_launch_app(command: String) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::LaunchApp { command, resp })?;
        Ok(())
    }

    pub fn agent_get_screen_size() -> Result<(u32, u32), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, DesktopRequest::GetScreenSize)
    }

    pub fn agent_get_window_list() -> Result<Vec<String>, String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, DesktopRequest::GetWindowList)
    }

    pub fn agent_focus_window(title: String) -> Result<(), String> {
        let guard = session_store().lock().map_err(|_| "Desktop session lock poisoned".to_string())?;
        let Some(session) = guard.as_ref() else {
            return Err("No active agent desktop".to_string());
        };
        let sender = session.sender.clone();
        drop(guard);
        send_request(sender, |resp| DesktopRequest::FocusWindow { title, resp })?;
        Ok(())
    }

    fn crop_desktop_screenshot(region: DesktopReadRegion, zoom: u32) -> Result<DesktopScreenshot, String> {
        let captured = unsafe { capture_desktop_screenshot() }?;
        let bytes = general_purpose::STANDARD
            .decode(captured.base64.as_bytes())
            .map_err(|e| format!("Failed to decode desktop screenshot: {e}"))?;
        let rgb = image::load_from_memory(&bytes)
            .map_err(|e| format!("Failed to load desktop screenshot: {e}"))?
            .to_rgb8();
        let (iw, ih) = rgb.dimensions();
        if iw == 0 || ih == 0 {
            return Err("Desktop screenshot had invalid dimensions".to_string());
        }

        let rx = region.x.clamp(0, iw as i32 - 1) as u32;
        let ry = region.y.clamp(0, ih as i32 - 1) as u32;
        let rw = (region.width.max(1) as u32).min(iw - rx);
        let rh = (region.height.max(1) as u32).min(ih - ry);
        let cropped = image::imageops::crop_imm(&rgb, rx, ry, rw, rh).to_image();
        let zoom = zoom.max(1);
        let scaled = if zoom > 1 {
            image::imageops::resize(
                &cropped,
                rw.saturating_mul(zoom),
                rh.saturating_mul(zoom),
                image::imageops::FilterType::Triangle,
            )
        } else {
            cropped
        };

        let mut encoded = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut encoded);
            let encoder = JpegEncoder::new_with_quality(&mut cursor, 82);
            DynamicImage::ImageRgb8(scaled.clone())
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
        }

        Ok(DesktopScreenshot {
            base64: general_purpose::STANDARD.encode(encoded),
            width: scaled.width(),
            height: scaled.height(),
        })
    }

    pub fn list_desktop_apps(query: Option<String>, limit: Option<usize>) -> Result<DesktopAppQueryResult, String> {
        query_desktop_apps(query.as_deref(), limit)
    }

    // ─── Deterministic launch: resolve → spawn → verify → learn ─────────────────

    /// A fully resolved way to launch an app. Built so we NEVER hand a pre-quoted,
    /// space-containing string to `cmd /C start` (that double-quotes the path and
    /// makes Windows report "cannot find the file ...").
    #[derive(Clone, Serialize, Deserialize)]
    #[serde(tag = "kind")]
    enum ResolvedLaunch {
        /// Launch an executable directly via CreateProcess. Rust handles quoting of
        /// the path and each argument correctly — this is the reliable path.
        Direct { program: String, args: Vec<String> },
        /// Launch through the shell (`cmd /C start "" <program> <args...>`) for things
        /// that are not plain exes: `.lnk` shortcuts, URIs like `ms-settings:`, and
        /// bare verbs (`calc`, `taskmgr`) that the shell resolves via App Paths. The
        /// program and each arg are passed as SEPARATE process arguments, so Rust
        /// quotes them once and correctly.
        Shell { program: String, args: Vec<String> },
    }

    fn split_ws(value: &str) -> Vec<String> {
        value.split_whitespace().map(|s| s.to_string()).collect()
    }

    /// A human-readable command string for logging / the tool result JSON.
    fn launch_display(launch: &ResolvedLaunch) -> String {
        let (program, args) = match launch {
            ResolvedLaunch::Direct { program, args } => (program, args),
            ResolvedLaunch::Shell { program, args } => (program, args),
        };
        let mut out = quote_cmd(program);
        for arg in args {
            out.push(' ');
            out.push_str(&quote_cmd(arg));
        }
        out
    }

    /// Resolve a dynamically-enumerated app into a reliable launch.
    fn resolve_app_launch(app: &DesktopAppInfo) -> ResolvedLaunch {
        match app.launch_kind.as_str() {
            // A real .exe — launch it directly.
            "exe" => ResolvedLaunch::Direct { program: app.launch_target.clone(), args: Vec::new() },
            // A Start Menu shortcut — explorer.exe reliably launches the .lnk target.
            "shortcut" => ResolvedLaunch::Direct {
                program: "explorer.exe".to_string(),
                args: vec![app.launch_target.clone()],
            },
            // A Start Apps / UWP id — open via the Apps folder (explorer is on PATH).
            "appx" => ResolvedLaunch::Direct {
                program: "explorer.exe".to_string(),
                args: vec![format!("shell:AppsFolder\\{}", app.launch_target)],
            },
            // A free-form command line.
            "command" => {
                let parts = split_ws(&app.launch_target);
                match parts.split_first() {
                    Some((program, args)) => ResolvedLaunch::Shell {
                        program: program.clone(),
                        args: args.to_vec(),
                    },
                    None => ResolvedLaunch::Shell { program: app.launch_target.clone(), args: Vec::new() },
                }
            }
            _ => ResolvedLaunch::Shell { program: app.launch_target.clone(), args: Vec::new() },
        }
    }

    /// Resolve the canonical executable path for `exe` via the Windows "App Paths"
    /// registry key (HKLM, WOW6432Node, HKCU). Version-independent.
    fn resolve_app_paths_exe(exe: &str) -> Option<String> {
        const ROOTS: [&str; 3] = [
            "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
            "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths",
            "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
        ];
        for root in ROOTS {
            let script = format!(
                "$ErrorActionPreference='SilentlyContinue'; $k = Get-Item -LiteralPath '{root}\\{exe}'; if ($k) {{ $v = $k.GetValue(''); if ($v) {{ $v }} }}"
            );
            if let Ok((out, _)) = powershell_run(&script) {
                let path = out.trim().trim_matches('"').trim().to_string();
                if !path.is_empty() && Path::new(&path).exists() {
                    return Some(path);
                }
            }
        }
        None
    }

    /// Find a Start Menu shortcut named `<name>.lnk` and return its full path.
    fn resolve_shortcut(name: &str) -> Option<String> {
        let safe = name.replace('\'', "''");
        let script = format!(
            r#"$ErrorActionPreference='SilentlyContinue'
$roots = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs","$env:ProgramData\Microsoft\Windows\Start Menu\Programs") | Where-Object {{ Test-Path $_ }}
$hit = $null
foreach ($r in $roots) {{
  $f = Get-ChildItem -Path $r -Filter '{safe}.lnk' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($f) {{ $hit = $f.FullName; break }}
}}
if ($hit) {{ $hit }}"#
        );
        powershell_run(&script)
            .ok()
            .map(|(out, _)| out.trim().to_string())
            .filter(|s| !s.is_empty() && Path::new(s).exists())
    }

    /// Resolve one catalog candidate into a reliable launch, or `None` if it is not
    /// available on this machine.
    fn resolve_candidate(candidate: &LaunchCandidate) -> Option<ResolvedLaunch> {
        match candidate {
            LaunchCandidate::AppPaths { exe, args } => {
                let path = resolve_app_paths_exe(exe)?;
                Some(ResolvedLaunch::Direct { program: path, args: split_ws(args) })
            }
            LaunchCandidate::ExeProbe { paths, args } => {
                for p in *paths {
                    if Path::new(p).exists() {
                        return Some(ResolvedLaunch::Direct { program: p.to_string(), args: split_ws(args) });
                    }
                }
                None
            }
            LaunchCandidate::Shortcut { name } => {
                let lnk = resolve_shortcut(name)?;
                // explorer.exe reliably resolves and launches a .lnk's target.
                Some(ResolvedLaunch::Direct { program: "explorer.exe".to_string(), args: vec![lnk] })
            }
            LaunchCandidate::PathCommand { command } => {
                let parts = split_ws(command);
                let (program, args) = parts.split_first()?;
                Some(ResolvedLaunch::Shell { program: program.clone(), args: args.to_vec() })
            }
        }
    }

    /// Launch a resolved app on the active agent desktop, or the real desktop.
    fn spawn_launch(launch: &ResolvedLaunch) -> Result<(), String> {
        if active_agent_desktop().is_some() {
            // The agent-desktop worker takes a single command line; build one safely.
            return agent_launch_app(launch_display(launch));
        }
        match launch {
            ResolvedLaunch::Direct { program, args } => Command::new(program)
                .args(args)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to launch {program}: {e}")),
            ResolvedLaunch::Shell { program, args } => Command::new("cmd")
                .args(["/C", "start", ""])
                .arg(program)
                .args(args)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to launch {program}: {e}")),
        }
    }

    /// Current process names (lowercased, without `.exe`) via `tasklist`.
    fn list_process_names() -> Vec<String> {
        let mut names = Vec::new();
        if let Ok(out) = Command::new("tasklist")
            .args(["/fo", "csv", "/nh"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if let Some(first) = line.split("\",\"").next() {
                    let n = first.trim().trim_matches('"').trim().to_ascii_lowercase();
                    if !n.is_empty() {
                        names.push(n.strip_suffix(".exe").unwrap_or(&n).to_string());
                    }
                }
            }
        }
        names
    }

    /// All visible top-level window titles on the current desktop.
    unsafe fn list_window_titles() -> Vec<String> {
        let mut titles: Vec<String> = Vec::new();
        EnumWindows(Some(enum_windows_proc), &mut titles as *mut _ as LPARAM);
        titles
    }

    /// Poll for up to `timeout_ms` until the app is confirmed running. Returns a
    /// human-readable label (preferably the detected window title) on success.
    fn verify_started(processes: &[String], titles: &[String], timeout_ms: u64) -> Option<String> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        loop {
            // Window-title match is preferred — it confirms a real window AND gives a
            // label the agent can use.
            if !titles.is_empty() {
                let window_titles = unsafe { list_window_titles() };
                for t in &window_titles {
                    let lower = t.to_lowercase();
                    if titles.iter().any(|needle| {
                        let n = needle.to_lowercase();
                        !n.is_empty() && lower.contains(&n)
                    }) {
                        return Some(t.clone());
                    }
                }
            }
            // Process match is the reliable "it started" signal. Use a prefix match
            // so a launcher like soffice.exe that immediately spawns soffice.bin (and
            // exits) is still detected via the long-lived soffice.bin.
            if !processes.is_empty() {
                let procs = list_process_names();
                if let Some(hit) = processes.iter().find(|p| {
                    let pl = p.to_ascii_lowercase();
                    procs.iter().any(|x| x == &pl || x.starts_with(&pl))
                }) {
                    return Some(format!("{hit} (process running)"));
                }
            }
            if std::time::Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(std::time::Duration::from_millis(350));
        }
    }

    /// Best-effort verify hints for a dynamically resolved app: the exe stem as the
    /// process name and the display name as a title substring.
    fn verify_hints_from_app(app: &DesktopAppInfo) -> (Vec<String>, Vec<String>) {
        let mut processes = Vec::new();
        if let Some(stem) = Path::new(&app.launch_target).file_stem() {
            let s = stem.to_string_lossy().to_ascii_lowercase();
            if !s.is_empty() {
                processes.push(s);
            }
        }
        (processes, vec![app.display_name.clone()])
    }

    // ── Learned launch cache (OpenClaw-style persistent memory) ──

    #[derive(Clone, Serialize, Deserialize)]
    struct LaunchCacheEntry {
        launch: ResolvedLaunch,
        app_id: String,
        display_name: String,
        verify_processes: Vec<String>,
        verify_titles: Vec<String>,
    }

    fn cache_file_path() -> Option<std::path::PathBuf> {
        dirs::data_local_dir().map(|d| d.join("LarundClick").join("app_launch_cache.json"))
    }

    fn cache_load_all() -> std::collections::HashMap<String, LaunchCacheEntry> {
        cache_file_path()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn cache_save_all(map: &std::collections::HashMap<String, LaunchCacheEntry>) {
        if let Some(p) = cache_file_path() {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(t) = serde_json::to_string_pretty(map) {
                let _ = std::fs::write(p, t);
            }
        }
    }

    fn cache_lookup(key: &str) -> Option<LaunchCacheEntry> {
        if key.is_empty() {
            return None;
        }
        cache_load_all().get(key).cloned()
    }

    fn cache_remove(key: &str) {
        let mut map = cache_load_all();
        if map.remove(key).is_some() {
            cache_save_all(&map);
        }
    }

    fn cache_store(
        key: &str,
        launch: &ResolvedLaunch,
        app_id: &str,
        display_name: &str,
        processes: &[String],
        titles: &[String],
    ) {
        if key.is_empty() {
            return;
        }
        let mut map = cache_load_all();
        map.insert(
            key.to_string(),
            LaunchCacheEntry {
                launch: launch.clone(),
                app_id: app_id.to_string(),
                display_name: display_name.to_string(),
                verify_processes: processes.to_vec(),
                verify_titles: titles.to_vec(),
            },
        );
        cache_save_all(&map);
    }

    #[allow(clippy::too_many_arguments)]
    fn launch_result_json(
        name: &Option<String>,
        app_id: &Option<String>,
        id: &str,
        display_name: &str,
        launch_command: &str,
        strategy: &str,
        verified: bool,
        detected: Option<String>,
    ) -> Result<String, String> {
        serde_json::to_string(&serde_json::json!({
            "status": "opened",
            "verified": verified,
            "detected_window": detected,
            "query": name,
            "app_id": app_id,
            "selected_app": { "id": id, "display_name": display_name },
            "launch_command": launch_command,
            "strategy_path": strategy
        }))
        .map_err(|e| e.to_string())
    }

    pub fn open_desktop_app(name: Option<String>, app_id: Option<String>) -> Result<String, String> {
        let query = name.clone().unwrap_or_default();

        // (1) Explicit app_id selected from a previous desktop_list_apps result.
        if let Some(id) = app_id.as_deref() {
            let app = resolve_desktop_app("", Some(id))?;
            let launch = resolve_app_launch(&app);
            spawn_launch(&launch)?;
            let (procs, titles) = verify_hints_from_app(&app);
            let detected = verify_started(&procs, &titles, 9000);
            let verified = detected.is_some();
            if verified {
                cache_store(&normalize_text(&app.display_name), &launch, &app.id, &app.display_name, &procs, &titles);
            }
            return launch_result_json(&name, &app_id, &app.id, &app.display_name, &launch_display(&launch), "explicit_app_id", verified, detected);
        }

        let norm = normalize_text(&query);

        // (2) Learned cache fast-path — instant and exact once an app has worked.
        if let Some(entry) = cache_lookup(&norm) {
            spawn_launch(&entry.launch)?;
            let detected = verify_started(&entry.verify_processes, &entry.verify_titles, 9000);
            if detected.is_some() {
                return launch_result_json(&name, &app_id, &entry.app_id, &entry.display_name, &launch_display(&entry.launch), "learned_cache", true, detected);
            }
            // Stale cache entry — drop it and re-resolve.
            cache_remove(&norm);
        }

        // (3) Curated catalog — deterministic, ordered launch strategies, each verified.
        if let Some(app) = match_known_app(&query) {
            let procs: Vec<String> = app.verify.processes.iter().map(|s| s.to_ascii_lowercase()).collect();
            let titles: Vec<String> = app.verify.title_contains.iter().map(|s| s.to_string()).collect();
            let mut tried: Vec<String> = Vec::new();
            for candidate in app.launch {
                let Some(launch) = resolve_candidate(candidate) else { continue; };
                tried.push(launch_display(&launch));
                spawn_launch(&launch)?;
                if let Some(detected) = verify_started(&procs, &titles, 9000) {
                    cache_store(&norm, &launch, app.id, app.display_name, &procs, &titles);
                    return launch_result_json(&name, &app_id, app.id, app.display_name, &launch_display(&launch), "catalog", true, Some(detected));
                }
            }
            if !tried.is_empty() {
                return Err(format!(
                    "app_launch_unverified: matched '{}' in the catalog and tried {} launch strateg{}, but none produced a visible window. The app may not be installed. Attempts: {}",
                    app.display_name,
                    tried.len(),
                    if tried.len() == 1 { "y" } else { "ies" },
                    tried.join(" | ")
                ));
            }
        }

        // (4) Fallback — dynamic fuzzy resolution, then launch + best-effort verify.
        let app = resolve_desktop_app(&query, None)?;
        let launch = resolve_app_launch(&app);
        spawn_launch(&launch)?;
        let (procs, titles) = verify_hints_from_app(&app);
        let detected = verify_started(&procs, &titles, 9000);
        let verified = detected.is_some();
        if verified {
            cache_store(&norm, &launch, &app.id, &app.display_name, &procs, &titles);
        }
        launch_result_json(&name, &app_id, &app.id, &app.display_name, &launch_display(&launch), "fallback_semantic", verified, detected)
    }

    pub fn desktop_read_debug(
        mode: Option<String>,
        region: Option<DesktopReadRegion>,
    ) -> Result<DesktopReadDebugResult, String> {
        let script = desktop_read_script(220);
        let run = powershell_run(&script);
        let (raw_stdout, raw_stderr, parsed) = match run {
            Ok((stdout, stderr)) => {
                let parsed = serde_json::from_str::<DesktopReadResult>(&stdout).ok().map(|mut result| {
                    if let Some(region) = region.as_ref() {
                        result.targets.retain(|target| is_target_in_region(&target.bounds, region));
                    }
                    for target in &mut result.targets {
                        infer_precision_metadata(target);
                    }
                    if mode.as_deref() == Some("precision") {
                        result.targets.sort_by(|a, b| {
                            b.target_confidence
                                .partial_cmp(&a.target_confidence)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        });
                    }
                    result.snapshot_token = format!(
                        "desktop-snapshot-{}",
                        NEXT_SNAPSHOT_ID.fetch_add(1, Ordering::SeqCst)
                    );
                    result
                });
                (stdout, stderr, parsed)
            }
            Err(error) => (String::new(), error, None),
        };
        Ok(DesktopReadDebugResult {
            success: parsed.is_some(),
            raw_stdout,
            raw_stderr,
            script,
            parsed,
        })
    }

    pub fn desktop_read(
        mode: Option<String>,
        region: Option<DesktopReadRegion>,
    ) -> Result<DesktopReadResult, String> {
        let result = read_desktop_snapshot(mode, region)?;
        let mut guard = target_snapshot_store()
            .lock()
            .map_err(|_| "Desktop target snapshot lock poisoned".to_string())?;
        *guard = Some(result.clone());
        Ok(result)
    }

    pub fn desktop_resolve_target(id: String, snapshot_token: String) -> Result<String, String> {
        let (_, target) = resolve_target(&id, &snapshot_token)?;
        let mut resolved = resolve_visual_anchor(&target);
        resolved.snapshot_token = snapshot_token;
        serde_json::to_string(&resolved).map_err(|e| e.to_string())
    }

    pub fn desktop_click_target(id: String, snapshot_token: String) -> Result<String, String> {
        let (_, target) = resolve_target(&id, &snapshot_token)?;
        if target.click_strategy == "visual_refine" || target.precision_level == "low" {
            return Err(format!(
                "target_not_precise_enough:{}",
                serde_json::to_string(&serde_json::json!({
                    "target_id": target.id,
                    "name": target.name,
                    "role": target.role,
                    "precision_level": target.precision_level,
                    "click_strategy": target.click_strategy,
                    "confidence": target.target_confidence
                }))
                .unwrap_or_else(|_| "{}".to_string())
            ));
        }
        let resolved = resolve_visual_anchor(&target);
        let x = resolved.anchor_x;
        let y = resolved.anchor_y;
        mouse_click_impl(x, y, Some("left".to_string()))?;
        std::thread::sleep(std::time::Duration::from_millis(160));
        serde_json::to_string(&serde_json::json!({
            "status": "click_confirmed",
            "verification": "click_confirmed",
            "target_id": target.id,
            "target_name": target.name,
            "role": target.role,
            "strategy_path": "semantic",
            "precision_path": "uia-direct",
            "method": resolved.method,
            "anchor_x": x,
            "anchor_y": y,
            "confidence": target.target_confidence
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_double_click_target(id: String, snapshot_token: String) -> Result<String, String> {
        let (_, target) = resolve_target(&id, &snapshot_token)?;
        let resolved = resolve_visual_anchor(&target);
        let x = resolved.anchor_x;
        let y = resolved.anchor_y;
        mouse_double_click_impl(x, y)?;
        std::thread::sleep(std::time::Duration::from_millis(180));
        serde_json::to_string(&serde_json::json!({
            "status": "click_confirmed",
            "verification": "click_confirmed",
            "target_id": target.id,
            "target_name": target.name,
            "role": target.role,
            "strategy_path": if target.click_strategy == "visual_refine" { "visual" } else { "semantic" },
            "precision_path": if target.click_strategy == "visual_refine" { "uia-refined" } else { "uia-direct" },
            "method": resolved.method,
            "anchor_x": x,
            "anchor_y": y,
            "confidence": target.target_confidence
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_invoke_target(id: String, snapshot_token: String) -> Result<String, String> {
        let (_, target) = resolve_target(&id, &snapshot_token)?;
        if !target.can_invoke {
            return Err("Target does not support native invoke. Use desktop_click_target instead.".to_string());
        }
        desktop_pattern_action(&id, "invoke", None)?;
        std::thread::sleep(std::time::Duration::from_millis(140));
        serde_json::to_string(&serde_json::json!({
            "status": "invoked",
            "verification": "invoked",
            "target_id": target.id,
            "target_name": target.name,
            "role": target.role,
            "strategy_path": "semantic",
            "precision_path": "uia-direct",
            "method": "invoke",
            "confidence": target.target_confidence
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_type_target(id: String, text: String, snapshot_token: String) -> Result<String, String> {
        let (_, target) = resolve_target(&id, &snapshot_token)?;
        desktop_pattern_action(&id, "focus", None)
            .or_else(|_| {
                let resolved = resolve_visual_anchor(&target);
                let (x, y) = (resolved.anchor_x, resolved.anchor_y);
                mouse_click_impl(x, y, Some("left".to_string()))?;
                Ok::<String, String>("clicked_to_focus".to_string())
            })?;
        std::thread::sleep(std::time::Duration::from_millis(120));
        type_text_impl(&text)?;
        serde_json::to_string(&serde_json::json!({
            "status": "focused",
            "verification": "focused",
            "target_id": target.id,
            "target_name": target.name,
            "role": target.role,
            "strategy_path": "semantic",
            "precision_path": "uia-direct",
            "chars": text.chars().count()
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_scroll_target(id: String, direction: String, amount: i32, snapshot_token: String) -> Result<String, String> {
        let (_, target) = resolve_target(&id, &snapshot_token)?;
        let repeats = amount.clamp(1, 12);
        if target.can_scroll {
            for _ in 0..repeats {
                desktop_pattern_action(
                    &id,
                    if direction.eq_ignore_ascii_case("up") { "scroll_up" } else { "scroll_down" },
                    None,
                )?;
            }
            return serde_json::to_string(&serde_json::json!({
                "status": "scrolled",
                "verification": "scrolled",
                "target_id": target.id,
                "target_name": target.name,
                "role": target.role,
                "direction": direction,
                "amount": repeats,
                "strategy_path": "semantic",
                "precision_path": "uia-direct"
            }))
            .map_err(|e| e.to_string());
        }

        let resolved = resolve_visual_anchor(&target);
        let (x, y) = (resolved.anchor_x, resolved.anchor_y);
        mouse_scroll_impl(x, y, direction.clone(), repeats)?;
        serde_json::to_string(&serde_json::json!({
            "status": "scrolled",
            "verification": "scrolled",
            "target_id": target.id,
            "target_name": target.name,
            "role": target.role,
            "direction": direction,
            "amount": repeats,
            "strategy_path": "visual",
            "precision_path": "uia-refined",
            "anchor_x": x,
            "anchor_y": y
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_click_point(x: i32, y: i32) -> Result<String, String> {
        mouse_click_impl(x, y, Some("left".to_string()))?;
        serde_json::to_string(&serde_json::json!({
            "status": "click_confirmed",
            "verification": "click_confirmed",
            "strategy_path": "raw_mouse",
            "precision_path": "visual-microtarget",
            "anchor_x": x,
            "anchor_y": y
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_focus_next() -> Result<String, String> {
        key_press_impl("tab")?;
        std::thread::sleep(std::time::Duration::from_millis(120));
        let focused = read_focused_element()?;
        serde_json::to_string(&serde_json::json!({
            "status": "focused",
            "verification": "focused",
            "strategy_path": "keyboard",
            "focused": focused
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_focus_prev() -> Result<String, String> {
        key_combo_impl(&["shift".to_string(), "tab".to_string()])?;
        std::thread::sleep(std::time::Duration::from_millis(120));
        let focused = read_focused_element()?;
        serde_json::to_string(&serde_json::json!({
            "status": "focused",
            "verification": "focused",
            "strategy_path": "keyboard",
            "focused": focused
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_read_focus() -> Result<String, String> {
        let focused = read_focused_element()?;
        serde_json::to_string(&serde_json::json!({
            "status": "focused",
            "verification": "focused",
            "strategy_path": "keyboard",
            "focused": focused
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_activate_focused() -> Result<String, String> {
        let focused = read_focused_element()?;
        if let Some(id) = focused.id.clone() {
            if focused.can_invoke {
                desktop_pattern_action(&id, "invoke", None)?;
            } else if matches!(focused.role.to_lowercase().as_str(), "checkbox" | "radiobutton") {
                key_press_impl("space")?;
            } else {
                key_press_impl("enter")?;
            }
        } else {
            key_press_impl("enter")?;
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
        serde_json::to_string(&serde_json::json!({
            "status": "invoked",
            "verification": "invoked",
            "strategy_path": "keyboard",
            "focused": focused
        }))
        .map_err(|e| e.to_string())
    }

    pub fn desktop_capture_region(region: DesktopReadRegion) -> Result<DesktopScreenshot, String> {
        crop_desktop_screenshot(region, 1)
    }

    pub fn desktop_zoom_target_region(
        id: Option<String>,
        snapshot_token: Option<String>,
        region: Option<DesktopReadRegion>,
        zoom: Option<u32>,
    ) -> Result<DesktopScreenshot, String> {
        let resolved_region = if let (Some(id), Some(snapshot_token)) = (id, snapshot_token) {
            let (_, target) = resolve_target(&id, &snapshot_token)?;
            DesktopReadRegion {
                x: target.bounds.x,
                y: target.bounds.y,
                width: target.bounds.width,
                height: target.bounds.height,
            }
        } else {
            region.ok_or_else(|| "region is required when no target id is provided".to_string())?
        };
        crop_desktop_screenshot(resolved_region, zoom.unwrap_or(2).clamp(1, 6))
    }

    pub fn desktop_visual_locate(
        id: Option<String>,
        snapshot_token: Option<String>,
        region: Option<DesktopReadRegion>,
    ) -> Result<String, String> {
        let (target_id, window_title, bounds, reason, confidence) =
            if let (Some(id), Some(snapshot_token)) = (id, snapshot_token) {
                let (_, target) = resolve_target(&id, &snapshot_token)?;
                (
                    Some(target.id.clone()),
                    target.window_title.clone(),
                    target.bounds.clone(),
                    format!("target {} requires visual micro-targeting", target.name),
                    target.target_confidence.clamp(0.35, 0.9),
                )
            } else if let Some(region) = region.clone() {
                (
                    None,
                    "foreground".to_string(),
                    DesktopBounds {
                        x: region.x,
                        y: region.y,
                        width: region.width,
                        height: region.height,
                    },
                    "manual region supplied for visual targeting".to_string(),
                    0.45,
                )
            } else {
                return Err("Either target id + snapshot_token or region is required.".to_string());
            };

        let center = DesktopVisualCandidate {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
            confidence,
            method: "center".to_string(),
        };
        let left_inner = DesktopVisualCandidate {
            x: bounds.x + (bounds.width / 4).clamp(6, 20),
            y: bounds.y + bounds.height / 2,
            confidence: (confidence - 0.08).clamp(0.1, 0.95),
            method: "left_inner".to_string(),
        };
        let safe = current_safe_point(&bounds);
        let result = DesktopVisualLocateResult {
            target_id,
            window_title,
            reason,
            confidence,
            candidate_points: vec![
                DesktopVisualCandidate {
                    x: safe.0,
                    y: safe.1,
                    confidence: (confidence + 0.04).clamp(0.1, 0.95),
                    method: "safe_inset".to_string(),
                },
                center,
                left_inner,
            ],
            next_region: Some(DesktopReadRegion {
                x: bounds.x.saturating_sub(8),
                y: bounds.y.saturating_sub(8),
                width: bounds.width.saturating_add(16),
                height: bounds.height.saturating_add(16),
            }),
        };
        serde_json::to_string(&result).map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
mod windows_impl {
    use super::*;

    pub fn active_agent_desktop() -> Option<AgentDesktopInfo> {
        None
    }

    pub fn create_agent_desktop() -> Result<AgentDesktopInfo, String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn close_agent_desktop(_id: u32) -> Result<(), String> {
        Ok(())
    }

    pub fn agent_screenshot() -> Result<DesktopScreenshot, String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_mouse_click(_: i32, _: i32, _: Option<String>) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_mouse_double_click(_: i32, _: i32) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_mouse_move(_: i32, _: i32) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_mouse_drag(_: i32, _: i32, _: i32, _: i32) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_mouse_scroll(_: i32, _: i32, _: String, _: i32) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_type_text(_: String) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_key_press(_: String) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_key_combo(_: Vec<String>) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_launch_app(_: String) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_get_screen_size() -> Result<(u32, u32), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_get_window_list() -> Result<Vec<String>, String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn agent_focus_window(_: String) -> Result<(), String> {
        Err("Agent desktops are only supported on Windows".to_string())
    }

    pub fn list_desktop_apps(_: Option<String>, _: Option<usize>) -> Result<DesktopAppQueryResult, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn open_desktop_app(_: Option<String>, _: Option<String>) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_read_debug(_: Option<String>, _: Option<DesktopReadRegion>) -> Result<DesktopReadDebugResult, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_read(_: Option<String>, _: Option<DesktopReadRegion>) -> Result<DesktopReadResult, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_resolve_target(_: String, _: String) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_click_target(_: String, _: String) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_double_click_target(_: String, _: String) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_invoke_target(_: String, _: String) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_type_target(_: String, _: String, _: String) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_scroll_target(_: String, _: String, _: i32, _: String) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_click_point(_: i32, _: i32) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_focus_next() -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_focus_prev() -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_read_focus() -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_activate_focused() -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_capture_region(_: DesktopReadRegion) -> Result<DesktopScreenshot, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_zoom_target_region(
        _: Option<String>,
        _: Option<String>,
        _: Option<DesktopReadRegion>,
        _: Option<u32>,
    ) -> Result<DesktopScreenshot, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }

    pub fn desktop_visual_locate(
        _: Option<String>,
        _: Option<String>,
        _: Option<DesktopReadRegion>,
    ) -> Result<String, String> {
        Err("Desktop targeting is only supported on Windows".to_string())
    }
}

pub use windows_impl::*;

#[cfg(all(test, target_os = "windows"))]
mod launch_tests {
    use super::*;

    fn kill_soffice() {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "soffice.bin", "/IM", "soffice.exe"])
            .output();
    }

    // Run with: cargo test --lib opens_libreoffice_calc_verified -- --ignored --nocapture
    #[test]
    #[ignore = "launches LibreOffice Calc on the real desktop"]
    fn opens_libreoffice_calc_verified() {
        kill_soffice();
        std::thread::sleep(std::time::Duration::from_secs(2));
        let json = open_desktop_app(Some("LibreOffice Calc".to_string()), None)
            .expect("open_desktop_app should not error");
        println!("RESULT: {json}");
        assert!(json.contains("\"verified\":true"), "not verified: {json}");
        kill_soffice();
    }
}
