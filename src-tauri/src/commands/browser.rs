//! Browser control via the Chrome DevTools Protocol (CDP).
//!
//! Vision-based mouse clicking is unreliable because the model has to guess pixel
//! coordinates. For browser tasks we instead drive Chrome over CDP: the model
//! targets elements by their visible text / selector and Chrome itself clicks the
//! element's exact center — pixel-perfect, regardless of the model's strength.
//!
//! Chrome 136+ refuses to open the remote-debugging port on the default profile
//! (a security mitigation), so we run a dedicated, persistent agent profile at
//! %LOCALAPPDATA%\LarundClick\AgentChrome. The user logs in once there and it
//! stays logged in for future tasks.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

use super::desktop::DesktopScreenshot;

const DEBUG_PORT: u16 = 9222;

// JS injected via Runtime.evaluate. Each is a function expression we invoke with
// JSON-encoded arguments, except READ_JS which is a self-calling IIFE.
const CLICK_JS: &str = r#"function(target){
function vis(e){try{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none';}catch(_){return false;}}
let el=null;
try{el=document.querySelector(target);if(el&&!vis(el))el=null;}catch(_){}
if(!el){const t=(target||'').trim().toLowerCase();
const c=[...document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],label,summary')];
const lab=e=>((e.innerText||e.value||(e.getAttribute&&e.getAttribute('aria-label'))||(e.getAttribute&&e.getAttribute('placeholder'))||e.title||'')+'').trim().toLowerCase();
el=c.find(e=>vis(e)&&lab(e)===t)||c.find(e=>vis(e)&&lab(e).includes(t));}
if(!el)return 'NOT_FOUND';
el.scrollIntoView({block:'center',inline:'center'});
const r=el.getBoundingClientRect();
const o={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,view:window};
el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));
if(typeof el.click==='function'){try{el.click();}catch(_){}}
return 'CLICKED '+el.tagName;}"#;

const TYPE_JS: &str = r#"function(target,text){
function vis(e){try{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none';}catch(_){return false;}}
let el=null;
try{el=document.querySelector(target);if(el&&!vis(el))el=null;}catch(_){}
if(!el){const t=(target||'').trim().toLowerCase();
const c=[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role=textbox],[role=searchbox],[role=combobox]')].filter(vis);
const lab=e=>(((e.getAttribute&&e.getAttribute('placeholder'))||(e.getAttribute&&e.getAttribute('aria-label'))||e.name||e.id||(e.labels&&e.labels[0]&&e.labels[0].innerText)||'')+'').toLowerCase();
if(t){const matches=c.filter(e=>lab(e).includes(t));
if(matches.length===1){el=matches[0];}
else if(matches.length>1){return 'AMBIGUOUS: '+matches.length+' inputs match "'+t+'" ('+matches.map(e=>lab(e)||e.tagName.toLowerCase()).slice(0,6).join(' | ')+'). Use a more specific target.';}
else{return 'NOT_FOUND';}}
else{
// No target given: only safe when exactly one input is visible. Never guess
// into a title/search box when several inputs exist.
if(c.length===1){el=c[0];}
else if(c.length>1){return 'AMBIGUOUS: '+c.length+' inputs on page ('+c.map(e=>lab(e)||e.tagName.toLowerCase()).slice(0,6).join(' | ')+'). Specify a target.';}
else{return 'NOT_FOUND';}}}
if(!el)return 'NOT_FOUND';
el.scrollIntoView({block:'center'});el.focus();
try{
if(el.isContentEditable){el.textContent='';document.execCommand('insertText',false,text);}
else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
const setter=Object.getOwnPropertyDescriptor(proto,'value').set;setter.call(el,text);
el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
}catch(_){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));}
return 'TYPED into '+el.tagName;}"#;

const READ_JS: &str = r#"(function(){
function vis(e){try{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none';}catch(_){return false;}}
const lab=e=>((e.innerText||e.value||(e.getAttribute&&e.getAttribute('aria-label'))||(e.getAttribute&&e.getAttribute('placeholder'))||e.title||'')+'').trim().replace(/\s+/g,' ').slice(0,70);
const inputs=[],buttons=[];
for(const e of document.querySelectorAll('input,textarea,select,[role=textbox],[role=searchbox],[role=combobox],[contenteditable="true"]')){if(!vis(e))continue;const tag=e.tagName.toLowerCase()+(e.type?('['+e.type+']'):'');inputs.push(tag+': '+lab(e));if(inputs.length>=40)break;}
for(const e of document.querySelectorAll('a,button,[role=button],[role=link],[role=tab],[role=menuitem]')){if(!vis(e))continue;const l=lab(e);if(l)buttons.push(l);if(buttons.length>=40)break;}
const ae=document.activeElement;
const focused=ae&&ae!==document.body?((ae.tagName||'').toLowerCase()+(ae.type?('['+ae.type+']'):'')+': '+(lab(ae)||(ae.getAttribute&&ae.getAttribute('aria-label'))||ae.id||'')).slice(0,80):'(none)';
const bodyText=((document.body&&document.body.innerText)||'').toLowerCase();
const hints=[];
if(/sign ?in|log ?in|bejelentkez|email or phone|choose an account|enter your password/.test(bodyText)||/accounts\.google\.com/.test(location.href))hints.push('login_required');
if(/captcha|i'?m not a robot|nem vagyok robot/.test(bodyText))hints.push('captcha');
if(/access denied|permission required|nincs jogosultság|403 forbidden/.test(bodyText))hints.push('permission_required');
return 'URL: '+location.href+'\nTITLE: '+document.title+'\nFOCUSED: '+focused+'\nSTATE_HINTS: '+(hints.join(',')||'none')+'\nINPUTS:\n'+inputs.join('\n')+'\nBUTTONS/LINKS:\n'+buttons.join(' | ');})()"#;

struct BrowserState {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: u64,
}

static BROWSER: OnceLock<Mutex<Option<BrowserState>>> = OnceLock::new();

fn store() -> &'static Mutex<Option<BrowserState>> {
    BROWSER.get_or_init(|| Mutex::new(None))
}

fn agent_profile_dir() -> String {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    format!("{}\\LarundClick\\AgentChrome", base)
}

fn chrome_exe() -> Option<String> {
    let candidates = [
        std::env::var("ProgramFiles").ok(),
        std::env::var("ProgramFiles(x86)").ok(),
        std::env::var("LOCALAPPDATA").ok(),
    ];
    for base in candidates.into_iter().flatten() {
        let p = format!("{}\\Google\\Chrome\\Application\\chrome.exe", base);
        if std::path::Path::new(&p).exists() {
            return Some(p);
        }
    }
    None
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// True once we have the full HTTP body according to Content-Length.
fn response_complete(buf: &[u8]) -> bool {
    let Some(pos) = find_subslice(buf, b"\r\n\r\n") else {
        return false;
    };
    let headers = String::from_utf8_lossy(&buf[..pos]).to_ascii_lowercase();
    let body_len = buf.len() - (pos + 4);
    if let Some(i) = headers.find("content-length:") {
        let num: String = headers[i + "content-length:".len()..]
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(cl) = num.parse::<usize>() {
            return body_len >= cl;
        }
    }
    false
}

/// Raw HTTP GET to the CDP HTTP endpoint (avoids pulling an HTTP client crate).
///
/// Chrome's DevTools HTTP server keeps the connection alive, so we must NOT rely
/// on the socket closing (read_to_end would block until the read timeout and
/// report failure). Instead we stop as soon as the full Content-Length body has
/// arrived, falling back to an idle read-timeout.
fn http_get(path: &str) -> Result<String, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", DEBUG_PORT)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(1500)))
        .ok();
    // Host MUST include the port: Chrome builds webSocketDebuggerUrl from this
    // header, and a portless Host yields ws://127.0.0.1/... (defaults to port 80
    // → connection fails).
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        path, DEBUG_PORT
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 8192];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break, // server closed the connection
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if response_complete(&buf) {
                    break; // received the whole body
                }
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                break // idle — assume the response is complete
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    if buf.is_empty() {
        return Err("no response from debug port".to_string());
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Parses the first JSON value out of an HTTP response body (tolerates the
/// chunked-encoding size markers Chrome may emit by reading a single value).
fn parse_json_http(resp: &str) -> Result<Value, String> {
    let body = resp.splitn(2, "\r\n\r\n").nth(1).unwrap_or(resp);
    let start = body.find(['{', '[']).ok_or("no JSON in response")?;
    let mut it = serde_json::Deserializer::from_str(&body[start..]).into_iter::<Value>();
    match it.next() {
        Some(Ok(v)) => Ok(v),
        Some(Err(e)) => Err(e.to_string()),
        None => Err("empty JSON".to_string()),
    }
}

fn launch_chrome() -> Result<(), String> {
    let exe = chrome_exe().ok_or("Chrome not found on this system")?;
    let dir = agent_profile_dir();
    std::fs::create_dir_all(&dir).ok();
    Command::new(exe)
        .args([
            format!("--remote-debugging-port={}", DEBUG_PORT),
            format!("--user-data-dir={}", dir),
            "--no-first-run".into(),
            "--no-default-browser-check".into(),
            "--remote-allow-origins=*".into(),
            "--start-maximized".into(),
            "--new-window".into(),
            "about:blank".into(),
        ])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_chrome() -> Result<(), String> {
    if http_get("/json/version").is_ok() {
        return Ok(());
    }
    launch_chrome()?;
    for _ in 0..40 {
        std::thread::sleep(Duration::from_millis(500));
        if http_get("/json/version").is_ok() {
            std::thread::sleep(Duration::from_millis(600));
            return Ok(());
        }
    }
    Err("Agent Chrome did not become reachable on the debug port".to_string())
}

fn connect_page() -> Result<BrowserState, String> {
    let list = parse_json_http(&http_get("/json/list")?)?;
    let arr = list.as_array().ok_or("CDP /json/list was not an array")?;
    let page = arr
        .iter()
        .find(|t| t.get("type").and_then(|x| x.as_str()) == Some("page"))
        .ok_or("No page target in agent Chrome")?;
    let ws_url_raw = page
        .get("webSocketDebuggerUrl")
        .and_then(|x| x.as_str())
        .ok_or("No webSocketDebuggerUrl for page target")?;
    // Defensive: ensure the URL carries the debug port even if Chrome omitted it.
    let ws_url = if let Some(rest) = ws_url_raw.strip_prefix("ws://127.0.0.1/") {
        format!("ws://127.0.0.1:{}/{}", DEBUG_PORT, rest)
    } else {
        ws_url_raw.to_string()
    };
    let (socket, _resp) = tungstenite::connect(&ws_url).map_err(|e| e.to_string())?;
    if let MaybeTlsStream::Plain(s) = socket.get_ref() {
        s.set_read_timeout(Some(Duration::from_secs(35))).ok();
    }
    Ok(BrowserState { socket, next_id: 0 })
}

fn cdp(state: &mut BrowserState, method: &str, params: Value) -> Result<Value, String> {
    state.next_id += 1;
    let id = state.next_id;
    let payload = json!({ "id": id, "method": method, "params": params }).to_string();
    state
        .socket
        .send(Message::Text(payload.into()))
        .map_err(|e| e.to_string())?;

    let deadline = Instant::now() + Duration::from_secs(40);
    loop {
        if Instant::now() > deadline {
            return Err("CDP response timeout".to_string());
        }
        let msg = state.socket.read().map_err(|e| e.to_string())?;
        match msg {
            Message::Text(t) => {
                let v: Value = match serde_json::from_str(t.as_str()) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if v.get("id").and_then(|x| x.as_u64()) == Some(id) {
                    if let Some(err) = v.get("error") {
                        return Err(format!("CDP error: {}", err));
                    }
                    return Ok(v.get("result").cloned().unwrap_or(Value::Null));
                }
                // otherwise it's an event or another id — keep reading
            }
            Message::Close(_) => return Err("CDP connection closed".to_string()),
            _ => {}
        }
    }
}

fn eval(state: &mut BrowserState, expr: &str) -> Result<String, String> {
    let res = cdp(
        state,
        "Runtime.evaluate",
        json!({ "expression": expr, "returnByValue": true, "awaitPromise": true }),
    )?;
    if let Some(exc) = res.get("exceptionDetails") {
        return Err(format!("JS error: {}", exc));
    }
    let val = res.get("result").and_then(|r| r.get("value"));
    Ok(match val {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => String::new(),
    })
}

fn wait_ready(state: &mut BrowserState) {
    for _ in 0..40 {
        if let Ok(rs) = eval(state, "document.readyState") {
            if rs == "complete" {
                std::thread::sleep(Duration::from_millis(400));
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

fn with_browser<T>(f: impl FnOnce(&mut BrowserState) -> Result<T, String>) -> Result<T, String> {
    let mut guard = store().lock().map_err(|_| "browser lock poisoned".to_string())?;
    if guard.is_none() {
        ensure_chrome()?;
        *guard = Some(connect_page()?);
    }
    let state = guard.as_mut().unwrap();
    let result = f(state);
    if let Err(e) = &result {
        // Drop the connection on transport-level failures so the next call
        // relaunches/reconnects (handles a closed tab or killed Chrome).
        let low = e.to_lowercase();
        if low.contains("closed")
            || low.contains("reset")
            || low.contains("timeout")
            || low.contains("os error")
            || low.contains("broken")
        {
            *guard = None;
        }
    }
    result
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn browser_open(url: String) -> Result<String, String> {
    with_browser(|s| {
        cdp(s, "Page.navigate", json!({ "url": url }))?;
        wait_ready(s);
        Ok(format!("Opened {}", url))
    })
}

#[tauri::command]
pub async fn browser_click(target: String) -> Result<String, String> {
    with_browser(|s| {
        let t = serde_json::to_string(&target).unwrap_or_else(|_| "\"\"".into());
        let r = eval(s, &format!("({})({})", CLICK_JS, t))?;
        if r.starts_with("NOT_FOUND") {
            return Err(format!("No element matching \"{}\" was found on the page", target));
        }
        wait_ready(s);
        Ok(r)
    })
}

#[tauri::command]
pub async fn browser_type(target: String, text: String) -> Result<String, String> {
    with_browser(|s| {
        let tg = serde_json::to_string(&target).unwrap_or_else(|_| "\"\"".into());
        let tx = serde_json::to_string(&text).unwrap_or_else(|_| "\"\"".into());
        let r = eval(s, &format!("({})({},{})", TYPE_JS, tg, tx))?;
        if r.starts_with("NOT_FOUND") {
            return Err(format!("No input matching \"{}\" was found on the page", target));
        }
        if r.starts_with("AMBIGUOUS") {
            // Surface as an error so the agent picks a more specific target rather
            // than silently typing into the wrong field (e.g. a sheet title box).
            return Err(r);
        }
        Ok(r)
    })
}

/// Maps a single non-modifier key name to (key, code, windowsVirtualKeyCode).
fn key_descriptor(k: &str) -> Result<(String, String, i64), String> {
    let lower = k.to_lowercase();
    if lower.len() == 1 {
        let ch = lower.chars().next().unwrap();
        if ch.is_ascii_alphabetic() {
            let up = ch.to_ascii_uppercase();
            return Ok((lower.clone(), format!("Key{}", up), up as i64));
        }
        if ch.is_ascii_digit() {
            return Ok((lower.clone(), format!("Digit{}", ch), ch as i64));
        }
    }
    match lower.as_str() {
        "enter" | "return" => Ok(("Enter".into(), "Enter".into(), 13)),
        "tab" => Ok(("Tab".into(), "Tab".into(), 9)),
        "escape" | "esc" => Ok(("Escape".into(), "Escape".into(), 27)),
        "space" => Ok((" ".into(), "Space".into(), 32)),
        "backspace" => Ok(("Backspace".into(), "Backspace".into(), 8)),
        "delete" | "del" => Ok(("Delete".into(), "Delete".into(), 46)),
        _ => Err(format!("Unsupported shortcut key: {}", k)),
    }
}

/// Sends a key combination (e.g. ["ctrl","v"]) to the page over CDP. CDP-injected
/// input events are trusted by Chrome, so Ctrl+V triggers a real clipboard paste —
/// this is how multi-cell TSV is pasted into a Google Sheet grid without a mouse.
#[tauri::command]
pub async fn browser_shortcut(keys: Vec<String>) -> Result<String, String> {
    with_browser(|s| {
        let mut modifiers: i64 = 0;
        let mut main: Option<(String, String, i64)> = None;
        for k in &keys {
            match k.to_lowercase().as_str() {
                "ctrl" | "control" => modifiers |= 2,
                "alt" => modifiers |= 1,
                "shift" => modifiers |= 8,
                "meta" | "cmd" | "command" | "win" => modifiers |= 4,
                other => main = Some(key_descriptor(other)?),
            }
        }
        let (key, code, vk) = main.ok_or("browser.shortcut needs one non-modifier key")?;
        let base = json!({
            "key": key, "code": code,
            "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk,
            "modifiers": modifiers,
        });
        let mut down = base.clone();
        down["type"] = json!("keyDown");
        let mut up = base;
        up["type"] = json!("keyUp");
        cdp(s, "Input.dispatchKeyEvent", down)?;
        cdp(s, "Input.dispatchKeyEvent", up)?;
        wait_ready(s);
        Ok(format!("Sent shortcut {}", keys.join("+")))
    })
}

#[tauri::command]
pub async fn browser_read() -> Result<String, String> {
    with_browser(|s| eval(s, READ_JS))
}

#[tauri::command]
pub async fn browser_key(key: String) -> Result<String, String> {
    with_browser(|s| {
        let (k, vk) = match key.to_lowercase().as_str() {
            "enter" | "return" => ("Enter", 13),
            "tab" => ("Tab", 9),
            "escape" | "esc" => ("Escape", 27),
            "backspace" => ("Backspace", 8),
            _ => return Err(format!("Unsupported browser key: {}", key)),
        };
        let p = json!({ "key": k, "code": k, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk });
        let mut down = p.clone();
        down["type"] = json!("keyDown");
        let mut up = p;
        up["type"] = json!("keyUp");
        cdp(s, "Input.dispatchKeyEvent", down)?;
        cdp(s, "Input.dispatchKeyEvent", up)?;
        wait_ready(s);
        Ok(format!("Pressed {}", key))
    })
}

#[tauri::command]
pub async fn browser_screenshot() -> Result<DesktopScreenshot, String> {
    with_browser(|s| {
        let res = cdp(
            s,
            "Page.captureScreenshot",
            json!({ "format": "jpeg", "quality": 70 }),
        )?;
        let data = res
            .get("data")
            .and_then(|d| d.as_str())
            .ok_or("CDP screenshot returned no data")?
            .to_string();
        let dims = eval(s, "JSON.stringify([window.innerWidth,window.innerHeight])")
            .unwrap_or_else(|_| "[0,0]".to_string());
        let wh: Vec<u32> = serde_json::from_str(&dims).unwrap_or_else(|_| vec![0, 0]);
        Ok(DesktopScreenshot {
            base64: data,
            width: *wh.first().unwrap_or(&0),
            height: *wh.get(1).unwrap_or(&0),
        })
    })
}

/// Waits for the page to reach a state — until `text` appears on the page, or
/// for `seconds` if no text is given. Used to wait out long operations (e.g. an
/// AI design being generated) before reading the result.
#[tauri::command]
pub async fn browser_wait(text: Option<String>, seconds: Option<u64>) -> Result<String, String> {
    let max = seconds.unwrap_or(20).min(120);
    match text {
        Some(t) if !t.trim().is_empty() => with_browser(|s| {
            let needle = serde_json::to_string(&t.to_lowercase()).unwrap_or_else(|_| "\"\"".into());
            let expr = format!(
                "!!(document.body && document.body.innerText.toLowerCase().includes({}))",
                needle
            );
            let start = Instant::now();
            loop {
                if eval(s, &expr).unwrap_or_default() == "true" {
                    return Ok(format!("\"{}\" appeared on the page", t));
                }
                if start.elapsed() > Duration::from_secs(max) {
                    return Ok(format!("Waited {}s; \"{}\" did not appear yet", max, t));
                }
                std::thread::sleep(Duration::from_millis(800));
            }
        }),
        _ => {
            std::thread::sleep(Duration::from_secs(max));
            Ok(format!("Waited {}s", max))
        }
    }
}

/// Non-launching probe: true when the agent Chrome is already reachable on the
/// debug port. Used by Vision Mouse V2 to decide whether to include the DOM
/// provider WITHOUT side-effect-launching Chrome (browser_read would launch it).
#[tauri::command]
pub async fn browser_probe() -> Result<bool, String> {
    Ok(http_get("/json/version").is_ok())
}

#[tauri::command]
pub async fn browser_close() -> Result<(), String> {
    let mut guard = store().lock().map_err(|_| "browser lock poisoned".to_string())?;
    if let Some(mut st) = guard.take() {
        let _ = cdp(&mut st, "Browser.close", json!({}));
    }
    Ok(())
}
