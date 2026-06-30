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

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

use super::desktop::DesktopScreenshot;

const DEFAULT_PORT: u16 = 9222;

/// Where to reach the active browser, and (optionally) how to launch it. Selected
/// per browser profile. `launch == None` means an already-running browser exposed
/// at `host:port` over CDP (we connect, never spawn).
#[derive(Clone, PartialEq)]
struct ActiveTarget {
    host: String,
    port: u16,
    launch: Option<LaunchSpec>,
}

#[derive(Clone, PartialEq)]
struct LaunchSpec {
    exe: String,
    profile_dir: String,
}

/// Browser profile config passed from the frontend (mirrors src/lib/browser/profiles.ts).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileArg {
    kind: String,
    executable_path: Option<String>,
    profile_dir: Option<String>,
    remote_debugging_port: Option<u16>,
    cdp_endpoint: Option<String>,
}

static ACTIVE: OnceLock<Mutex<Option<ActiveTarget>>> = OnceLock::new();

fn active_store() -> &'static Mutex<Option<ActiveTarget>> {
    ACTIVE.get_or_init(|| Mutex::new(None))
}

fn default_target() -> ActiveTarget {
    ActiveTarget {
        host: "127.0.0.1".into(),
        port: DEFAULT_PORT,
        launch: Some(LaunchSpec {
            exe: chrome_exe().unwrap_or_default(),
            profile_dir: agent_profile_dir("AgentChrome"),
        }),
    }
}

fn current_target() -> ActiveTarget {
    active_store()
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(default_target)
}

/// Translate a frontend browser profile into a concrete target. Returns an error
/// for non-Chromium / unconfigured profiles instead of silently guessing.
fn target_from_profile(p: &BrowserProfileArg) -> Result<ActiveTarget, String> {
    let port = p.remote_debugging_port.unwrap_or(DEFAULT_PORT);
    match p.kind.as_str() {
        "agent_chrome" => Ok(ActiveTarget {
            host: "127.0.0.1".into(),
            port,
            launch: Some(LaunchSpec {
                exe: chrome_exe().ok_or("Chrome was not found on this system.")?,
                profile_dir: p.profile_dir.clone().unwrap_or_else(|| agent_profile_dir("AgentChrome")),
            }),
        }),
        "agent_edge" => Ok(ActiveTarget {
            host: "127.0.0.1".into(),
            port,
            launch: Some(LaunchSpec {
                exe: edge_exe().ok_or("Microsoft Edge was not found on this system.")?,
                profile_dir: p.profile_dir.clone().unwrap_or_else(|| agent_profile_dir("AgentEdge")),
            }),
        }),
        "custom_chromium" => {
            let exe = p.executable_path.clone().filter(|e| !e.is_empty())
                .ok_or("Custom browser needs an executable path.")?;
            Ok(ActiveTarget {
                host: "127.0.0.1".into(),
                port,
                launch: Some(LaunchSpec {
                    exe,
                    profile_dir: p.profile_dir.clone().unwrap_or_else(|| agent_profile_dir("AgentCustom")),
                }),
            })
        }
        "existing_cdp" => {
            let endpoint = p.cdp_endpoint.clone().filter(|e| !e.is_empty())
                .ok_or("Existing CDP profile needs a cdp endpoint (e.g. http://localhost:9223).")?;
            let parsed = url_host_port(&endpoint)?;
            Ok(ActiveTarget { host: parsed.0, port: parsed.1, launch: None })
        }
        other => Err(format!(
            "Larund can only automate Chromium-based browsers through CDP right now (got '{}').",
            other
        )),
    }
}

/// Minimal host:port parse for an http(s) CDP endpoint.
fn url_host_port(endpoint: &str) -> Result<(String, u16), String> {
    let rest = endpoint
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let authority = rest.split('/').next().unwrap_or(rest);
    let mut parts = authority.split(':');
    let host = parts.next().filter(|h| !h.is_empty()).ok_or("CDP endpoint missing host")?;
    let port = parts
        .next()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    Ok((host.to_string(), port))
}

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

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabInfo {
    id: String,
    title: String,
    url: String,
    active: bool,
}

#[derive(Clone, Debug)]
struct TargetInfo {
    id: String,
    title: String,
    url: String,
    type_name: String,
    opener_id: Option<String>,
}

struct BrowserState {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: u64,
    targets: HashMap<String, TargetInfo>,
    target_sessions: HashMap<String, String>,
    session_targets: HashMap<String, String>,
    active_target_id: Option<String>,
    previous_target_id: Option<String>,
    recent_tab_notice: Option<String>,
    active_requests: HashMap<String, usize>,
}

static BROWSER: OnceLock<Mutex<Option<BrowserState>>> = OnceLock::new();

fn store() -> &'static Mutex<Option<BrowserState>> {
    BROWSER.get_or_init(|| Mutex::new(None))
}

fn agent_profile_dir(name: &str) -> String {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    format!("{}\\LarundClick\\{}", base, name)
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

fn edge_exe() -> Option<String> {
    let candidates = [
        std::env::var("ProgramFiles(x86)").ok(),
        std::env::var("ProgramFiles").ok(),
    ];
    for base in candidates.into_iter().flatten() {
        let p = format!("{}\\Microsoft\\Edge\\Application\\msedge.exe", base);
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
    let target = current_target();
    let mut stream = TcpStream::connect((target.host.as_str(), target.port)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(1500)))
        .ok();
    // Host MUST include the port: Chrome builds webSocketDebuggerUrl from this
    // header, and a portless Host yields ws://host/... (defaults to port 80
    // → connection fails).
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: {}:{}\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        path, target.host, target.port
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

fn launch_browser(target: &ActiveTarget) -> Result<(), String> {
    let spec = target.launch.as_ref().ok_or("This browser profile connects to an existing CDP endpoint and is not started by Larund.")?;
    if spec.exe.is_empty() {
        return Err("No browser executable is configured for this profile.".to_string());
    }
    std::fs::create_dir_all(&spec.profile_dir).ok();
    Command::new(&spec.exe)
        .args([
            format!("--remote-debugging-port={}", target.port),
            format!("--user-data-dir={}", spec.profile_dir),
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

fn ensure_browser() -> Result<(), String> {
    if http_get("/json/version").is_ok() {
        return Ok(());
    }
    let target = current_target();
    // Existing-CDP profiles are never launched — they must already be reachable.
    if target.launch.is_none() {
        return Err(format!(
            "No browser reachable at {}:{}. Start it with --remote-debugging-port, or pick a managed browser profile.",
            target.host, target.port
        ));
    }
    launch_browser(&target)?;
    for _ in 0..40 {
        std::thread::sleep(Duration::from_millis(500));
        if http_get("/json/version").is_ok() {
            std::thread::sleep(Duration::from_millis(600));
            return Ok(());
        }
    }
    Err("The browser did not become reachable on the debug port".to_string())
}

fn target_info_from_value(v: &Value) -> Option<TargetInfo> {
    let id = v.get("targetId").or_else(|| v.get("id")).and_then(|x| x.as_str())?.to_string();
    Some(TargetInfo {
        id,
        title: v.get("title").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
        url: v.get("url").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
        type_name: v.get("type").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
        opener_id: v.get("openerId").and_then(|x| x.as_str()).map(|s| s.to_string()),
    })
}

fn choose_page_target(targets: &HashMap<String, TargetInfo>) -> Option<&TargetInfo> {
    targets
        .values()
        .filter(|t| t.type_name == "page")
        .max_by_key(|t| (!t.url.starts_with("about:"), !t.url.is_empty()))
}

fn version_ws_url() -> Result<String, String> {
    let version = parse_json_http(&http_get("/json/version")?)?;
    let ws_url_raw = version
        .get("webSocketDebuggerUrl")
        .and_then(|x| x.as_str())
        .ok_or("No browser-level webSocketDebuggerUrl from /json/version")?;
    let target = current_target();
    Ok(if let Some(rest) = ws_url_raw.strip_prefix("ws://127.0.0.1/") {
        format!("ws://{}:{}/{}", target.host, target.port, rest)
    } else {
        ws_url_raw.to_string()
    })
}

fn read_initial_targets() -> HashMap<String, TargetInfo> {
    let mut out = HashMap::new();
    if let Ok(resp) = http_get("/json/list") {
        if let Ok(list) = parse_json_http(&resp) {
            if let Some(arr) = list.as_array() {
                for v in arr {
                    if let Some(info) = target_info_from_value(v) {
                        out.insert(info.id.clone(), info);
                    }
                }
            }
        }
    }
    out
}

fn connect_browser() -> Result<BrowserState, String> {
    let ws_url = version_ws_url()?;
    let (socket, _resp) = tungstenite::connect(&ws_url).map_err(|e| e.to_string())?;
    if let MaybeTlsStream::Plain(s) = socket.get_ref() {
        s.set_read_timeout(Some(Duration::from_secs(35))).ok();
    }
    let targets = read_initial_targets();
    let active_target_id = choose_page_target(&targets).map(|t| t.id.clone());
    let mut state = BrowserState {
        socket,
        next_id: 0,
        targets,
        target_sessions: HashMap::new(),
        session_targets: HashMap::new(),
        active_target_id,
        previous_target_id: None,
        recent_tab_notice: None,
        active_requests: HashMap::new(),
    };
    cdp_root(&mut state, "Target.setDiscoverTargets", json!({ "discover": true })).ok();
    refresh_targets(&mut state).ok();
    ensure_active_session(&mut state)?;
    enable_session_domains(&mut state).ok();
    Ok(state)
}

fn refresh_targets(state: &mut BrowserState) -> Result<(), String> {
    let res = cdp_root(state, "Target.getTargets", json!({}))?;
    if let Some(infos) = res.get("targetInfos").and_then(|x| x.as_array()) {
        for v in infos {
            if let Some(info) = target_info_from_value(v) {
                state.targets.insert(info.id.clone(), info);
            }
        }
    }
    if state.active_target_id.is_none() {
        state.active_target_id = choose_page_target(&state.targets).map(|t| t.id.clone());
    }
    Ok(())
}

fn ensure_active_session(state: &mut BrowserState) -> Result<String, String> {
    if state.active_target_id.is_none() {
        refresh_targets(state).ok();
    }
    let target_id = state
        .active_target_id
        .clone()
        .or_else(|| choose_page_target(&state.targets).map(|t| t.id.clone()))
        .ok_or("No page target in agent browser")?;
    state.active_target_id = Some(target_id.clone());
    if let Some(sid) = state.target_sessions.get(&target_id) {
        return Ok(sid.clone());
    }
    let res = cdp_root(
        state,
        "Target.attachToTarget",
        json!({ "targetId": target_id, "flatten": true }),
    )?;
    let sid = res
        .get("sessionId")
        .and_then(|x| x.as_str())
        .ok_or("Target.attachToTarget returned no sessionId")?
        .to_string();
    state.target_sessions.insert(target_id.clone(), sid.clone());
    state.session_targets.insert(sid.clone(), target_id);
    Ok(sid)
}

fn enable_session_domains(state: &mut BrowserState) -> Result<(), String> {
    cdp(state, "Page.enable", json!({})).ok();
    cdp(state, "Runtime.enable", json!({})).ok();
    cdp(state, "DOM.enable", json!({})).ok();
    cdp(state, "Network.enable", json!({})).ok();
    Ok(())
}

fn handle_cdp_event(state: &mut BrowserState, v: &Value) {
    let Some(method) = v.get("method").and_then(|x| x.as_str()) else { return };
    let params = v.get("params").unwrap_or(&Value::Null);
    match method {
        "Target.targetCreated" | "Target.targetInfoChanged" => {
            if let Some(info) = params.get("targetInfo").and_then(target_info_from_value) {
                let is_new_popup = method == "Target.targetCreated"
                    && info.type_name == "page"
                    && info.opener_id.as_deref() == state.active_target_id.as_deref();
                let id = info.id.clone();
                let url = info.url.clone();
                state.targets.insert(id.clone(), info);
                if is_new_popup {
                    state.previous_target_id = state.active_target_id.clone();
                    state.active_target_id = Some(id.clone());
                    state.recent_tab_notice = Some(format!("AUTO_TAB_SWITCH: opened popup tab {} {}", id, url));
                }
            }
        }
        "Target.targetDestroyed" => {
            if let Some(target_id) = params.get("targetId").and_then(|x| x.as_str()) {
                let target_id = target_id.to_string();
                state.targets.remove(&target_id);
                if let Some(sid) = state.target_sessions.remove(&target_id) {
                    state.session_targets.remove(&sid);
                    state.active_requests.remove(&sid);
                }
                if state.active_target_id.as_deref() == Some(&target_id) {
                    if let Some(prev) = state.previous_target_id.clone().filter(|p| state.targets.contains_key(p)) {
                        state.active_target_id = Some(prev.clone());
                        state.recent_tab_notice = Some(format!("AUTO_TAB_SWITCH: popup closed; returned to tab {}", prev));
                    } else {
                        state.active_target_id = choose_page_target(&state.targets).map(|t| t.id.clone());
                    }
                }
            }
        }
        "Target.attachedToTarget" => {
            let sid = params.get("sessionId").and_then(|x| x.as_str()).map(|s| s.to_string());
            let tid = params
                .get("targetInfo")
                .and_then(|x| x.get("targetId"))
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            if let (Some(sid), Some(tid)) = (sid, tid) {
                state.target_sessions.insert(tid.clone(), sid.clone());
                state.session_targets.insert(sid, tid);
            }
        }
        "Network.requestWillBeSent" => {
            if let Some(sid) = v.get("sessionId").and_then(|x| x.as_str()) {
                *state.active_requests.entry(sid.to_string()).or_insert(0) += 1;
            }
        }
        "Network.loadingFinished" | "Network.loadingFailed" => {
            if let Some(sid) = v.get("sessionId").and_then(|x| x.as_str()) {
                let entry = state.active_requests.entry(sid.to_string()).or_insert(0);
                *entry = entry.saturating_sub(1);
            }
        }
        _ => {}
    }
}

fn cdp_send(state: &mut BrowserState, method: &str, params: Value, session_id: Option<String>) -> Result<Value, String> {
    state.next_id += 1;
    let id = state.next_id;
    let mut payload = json!({ "id": id, "method": method, "params": params });
    if let Some(sid) = &session_id {
        payload["sessionId"] = json!(sid);
    }
    state
        .socket
        .send(Message::Text(payload.to_string().into()))
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
                handle_cdp_event(state, &v);
                // otherwise it's an event or another id — keep reading
            }
            Message::Close(_) => return Err("CDP connection closed".to_string()),
            _ => {}
        }
    }
}

fn cdp_root(state: &mut BrowserState, method: &str, params: Value) -> Result<Value, String> {
    cdp_send(state, method, params, None)
}

fn cdp(state: &mut BrowserState, method: &str, params: Value) -> Result<Value, String> {
    let sid = ensure_active_session(state)?;
    cdp_send(state, method, params, Some(sid))
}

fn eval(state: &mut BrowserState, expr: &str) -> Result<String, String> {
    eval_in_context(state, expr, None)
}

fn eval_in_context(state: &mut BrowserState, expr: &str, context_id: Option<i64>) -> Result<String, String> {
    let mut params = json!({ "expression": expr, "returnByValue": true, "awaitPromise": true });
    if let Some(ctx) = context_id {
        params["contextId"] = json!(ctx);
    }
    let res = cdp(
        state,
        "Runtime.evaluate",
        params,
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

fn frame_ids_from_tree_node(node: &Value, out: &mut Vec<String>) {
    if let Some(id) = node
        .get("frame")
        .and_then(|f| f.get("id"))
        .and_then(|x| x.as_str())
    {
        out.push(id.to_string());
    }
    if let Some(children) = node.get("childFrames").and_then(|x| x.as_array()) {
        for child in children {
            frame_ids_from_tree_node(child, out);
        }
    }
}

fn frame_execution_contexts(state: &mut BrowserState) -> Vec<i64> {
    let mut contexts = Vec::new();
    if let Ok(tree) = cdp(state, "Page.getFrameTree", json!({})) {
        let mut frame_ids = Vec::new();
        if let Some(root) = tree.get("frameTree") {
            frame_ids_from_tree_node(root, &mut frame_ids);
        }
        for frame_id in frame_ids.into_iter().skip(1) {
            if let Ok(world) = cdp(
                state,
                "Page.createIsolatedWorld",
                json!({ "frameId": frame_id, "worldName": "larund-click" }),
            ) {
                if let Some(ctx) = world.get("executionContextId").and_then(|x| x.as_i64()) {
                    contexts.push(ctx);
                }
            }
        }
    }
    contexts
}

fn eval_across_frames(state: &mut BrowserState, expr: &str) -> Result<String, String> {
    let first = eval(state, expr)?;
    if !first.starts_with("NOT_FOUND") {
        return Ok(first);
    }
    for ctx in frame_execution_contexts(state) {
        if let Ok(r) = eval_in_context(state, expr, Some(ctx)) {
            if !r.starts_with("NOT_FOUND") {
                return Ok(if r.starts_with("CLICKED") || r.starts_with("TYPED") {
                    format!("{r} in iframe")
                } else {
                    r
                });
            }
        }
    }
    Ok(first)
}

fn network_idle(state: &mut BrowserState, quiet: Duration, max: Duration) {
    let sid = match ensure_active_session(state) {
        Ok(s) => s,
        Err(_) => return,
    };
    let start = Instant::now();
    let mut idle_since: Option<Instant> = None;
    while start.elapsed() < max {
        let active = *state.active_requests.get(&sid).unwrap_or(&0);
        if active == 0 {
            let since = idle_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= quiet {
                return;
            }
        } else {
            idle_since = None;
        }
        std::thread::sleep(Duration::from_millis(100));
        // Give the CDP socket a chance to surface network events by issuing a cheap command.
        let _ = cdp(state, "Runtime.evaluate", json!({ "expression": "1", "returnByValue": true }));
    }
}

fn wait_ready(state: &mut BrowserState) {
    for _ in 0..40 {
        if let Ok(rs) = eval(state, "document.readyState") {
            if rs == "complete" {
                network_idle(state, Duration::from_millis(500), Duration::from_secs(3));
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

fn is_transient_cdp_error(e: &str) -> bool {
    let low = e.to_lowercase();
    low.contains("closed")
        || low.contains("reset")
        || low.contains("timeout")
        || low.contains("os error")
        || low.contains("broken")
        || low.contains("execution context was destroyed")
        || low.contains("target closed")
        || low.contains("session")
}

fn with_browser<T>(f: impl Fn(&mut BrowserState) -> Result<T, String>) -> Result<T, String> {
    let mut guard = store().lock().map_err(|_| "browser lock poisoned".to_string())?;
    if guard.is_none() {
        ensure_browser()?;
        *guard = Some(connect_browser()?);
    }
    let result = f(guard.as_mut().unwrap());
    if let Err(e) = &result {
        if is_transient_cdp_error(e) {
            *guard = None;
            ensure_browser()?;
            *guard = Some(connect_browser()?);
            return f(guard.as_mut().unwrap());
        }
    }
    result
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Switch the active browser target if a profile is supplied and differs from the
/// current one. Drops any existing CDP connection so the next call reconnects to
/// the new browser.
fn apply_profile(profile: Option<BrowserProfileArg>) -> Result<(), String> {
    let Some(p) = profile else { return Ok(()) };
    let target = target_from_profile(&p)?;
    let mut active = active_store().lock().map_err(|_| "browser active lock poisoned".to_string())?;
    if active.as_ref() != Some(&target) {
        *active = Some(target);
        // Force reconnect to the new target on the next browser call.
        if let Ok(mut b) = store().lock() {
            *b = None;
        }
    }
    Ok(())
}

fn tab_list(state: &mut BrowserState) -> Vec<BrowserTabInfo> {
    refresh_targets(state).ok();
    let active = state.active_target_id.clone();
    let mut tabs: Vec<BrowserTabInfo> = state
        .targets
        .values()
        .filter(|t| t.type_name == "page")
        .map(|t| BrowserTabInfo {
            id: t.id.clone(),
            title: t.title.clone(),
            url: t.url.clone(),
            active: Some(&t.id) == active.as_ref(),
        })
        .collect();
    tabs.sort_by(|a, b| b.active.cmp(&a.active).then(a.title.cmp(&b.title)));
    tabs
}

fn session_header(state: &mut BrowserState) -> String {
    let tabs = tab_list(state);
    let active = tabs.iter().find(|t| t.active);
    let notice = state.recent_tab_notice.take();
    format!(
        "TABS: {} open; active={} {} {}\n{}",
        tabs.len(),
        active.map(|t| t.id.as_str()).unwrap_or("(none)"),
        active.map(|t| t.title.as_str()).unwrap_or(""),
        active.map(|t| t.url.as_str()).unwrap_or(""),
        notice.unwrap_or_else(|| "AUTO_TAB_SWITCH: none".to_string())
    )
}

#[tauri::command]
pub async fn browser_list_tabs() -> Result<Vec<BrowserTabInfo>, String> {
    with_browser(|s| Ok(tab_list(s)))
}

#[tauri::command]
pub async fn browser_switch_tab(target_id: String) -> Result<String, String> {
    with_browser(|s| {
        refresh_targets(s).ok();
        let info = s
            .targets
            .get(&target_id)
            .filter(|t| t.type_name == "page")
            .cloned()
            .ok_or_else(|| format!("No page tab with target id {target_id}"))?;
        s.previous_target_id = s.active_target_id.clone();
        s.active_target_id = Some(target_id.clone());
        ensure_active_session(s)?;
        enable_session_domains(s).ok();
        s.recent_tab_notice = Some(format!("AUTO_TAB_SWITCH: manual switch to tab {} {}", info.id, info.url));
        Ok(format!("Switched to tab {} {}", info.id, info.url))
    })
}

#[tauri::command]
pub async fn browser_open(url: String, browser_profile: Option<BrowserProfileArg>) -> Result<String, String> {
    apply_profile(browser_profile)?;
    with_browser(|s| {
        cdp(s, "Page.navigate", json!({ "url": url }))?;
        wait_ready(s);
        Ok(format!("Opened {}", url))
    })
}

#[tauri::command]
pub async fn browser_click(target: String) -> Result<String, String> {
    with_browser(|s| {
        let before = s.active_target_id.clone();
        let t = serde_json::to_string(&target).unwrap_or_else(|_| "\"\"".into());
        let r = eval_across_frames(s, &format!("({})({})", CLICK_JS, t))?;
        if r.starts_with("NOT_FOUND") {
            return Err(format!("No element matching \"{}\" was found on the page", target));
        }
        wait_ready(s);
        if s.active_target_id == before {
            refresh_targets(s).ok();
        }
        Ok(r)
    })
}

#[tauri::command]
pub async fn browser_type(target: String, text: String) -> Result<String, String> {
    with_browser(|s| {
        let tg = serde_json::to_string(&target).unwrap_or_else(|_| "\"\"".into());
        let tx = serde_json::to_string(&text).unwrap_or_else(|_| "\"\"".into());
        let r = eval_across_frames(s, &format!("({})({},{})", TYPE_JS, tg, tx))?;
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
        "arrowdown" | "down" => Ok(("ArrowDown".into(), "ArrowDown".into(), 40)),
        "arrowup" | "up" => Ok(("ArrowUp".into(), "ArrowUp".into(), 38)),
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
pub async fn browser_read(selector: Option<String>) -> Result<String, String> {
    with_browser(|s| match selector.as_ref() {
        Some(sel) if !sel.trim().is_empty() => {
            let q = serde_json::to_string(&sel).unwrap_or_else(|_| "\"\"".into());
            let expr = format!(
                "(function(s){{const e=document.querySelector(s);return e?((e.innerText||e.value||e.textContent||'')+'').trim():'NOT_FOUND';}})({})",
                q
            );
            let r = eval_across_frames(s, &expr)?;
            if r == "NOT_FOUND" {
                return Err(format!("No element matching \"{}\" was found on the page", sel));
            }
            Ok(r)
        }
        _ => {
            let header = session_header(s);
            Ok(format!("{}\n{}", header, eval(s, READ_JS)?))
        }
    })
}

#[tauri::command]
pub async fn browser_key(key: String) -> Result<String, String> {
    with_browser(|s| {
        let (k, code, vk) = key_descriptor(&key)?;
        let p = json!({ "key": k, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk });
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

fn dispatch_key(state: &mut BrowserState, key: &str) -> Result<(), String> {
    let (k, code, vk) = key_descriptor(key)?;
    let p = json!({ "key": k, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk });
    let mut down = p.clone();
    down["type"] = json!("keyDown");
    let mut up = p;
    up["type"] = json!("keyUp");
    cdp(state, "Input.dispatchKeyEvent", down)?;
    cdp(state, "Input.dispatchKeyEvent", up)?;
    Ok(())
}

fn element_center_via_dom(state: &mut BrowserState, selector: &str) -> Result<(f64, f64), String> {
    let doc = cdp(state, "DOM.getDocument", json!({ "depth": -1, "pierce": true }))?;
    let root = doc
        .get("root")
        .and_then(|r| r.get("nodeId"))
        .and_then(|n| n.as_i64())
        .ok_or("could not read document root")?;
    let found = cdp(state, "DOM.querySelector", json!({ "nodeId": root, "selector": selector }))?;
    let node_id = found
        .get("nodeId")
        .and_then(|n| n.as_i64())
        .filter(|n| *n != 0)
        .ok_or("selector_not_found")?;
    cdp(state, "DOM.scrollIntoViewIfNeeded", json!({ "nodeId": node_id })).ok();
    let model = cdp(state, "DOM.getBoxModel", json!({ "nodeId": node_id }))?;
    let content = model
        .get("model")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
        .ok_or("box_model_missing")?;
    let xs: Vec<f64> = content.iter().step_by(2).filter_map(|v| v.as_f64()).collect();
    let ys: Vec<f64> = content.iter().skip(1).step_by(2).filter_map(|v| v.as_f64()).collect();
    if xs.is_empty() || ys.is_empty() {
        return Err("box_model_empty".to_string());
    }
    Ok((xs.iter().sum::<f64>() / xs.len() as f64, ys.iter().sum::<f64>() / ys.len() as f64))
}

fn element_center_via_js(state: &mut BrowserState, target: &str) -> Result<(f64, f64), String> {
    let q = serde_json::to_string(target).unwrap_or_else(|_| "\"\"".into());
    let js = format!(
        r#"(function(target){{
function vis(e){{try{{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none';}}catch(_){{return false;}}}}
function lab(e){{return (((e.getAttribute&&e.getAttribute('placeholder'))||(e.getAttribute&&e.getAttribute('aria-label'))||e.name||e.id||(e.labels&&e.labels[0]&&e.labels[0].innerText)||'')+'').toLowerCase();}}
let el=null;try{{el=document.querySelector(target);if(el&&!vis(el))el=null;}}catch(_){{}}
if(!el){{const t=(target||'').trim().toLowerCase();const c=[...document.querySelectorAll('input,textarea,[role=textbox],[role=searchbox],[role=combobox]')].filter(vis);el=c.find(e=>lab(e).includes(t));}}
if(!el)return 'NOT_FOUND';
el.scrollIntoView({{block:'center',inline:'center'}});
const r=el.getBoundingClientRect();return JSON.stringify([r.left+r.width/2,r.top+r.height/2]);}})({})"#,
        q
    );
    let r = eval_across_frames(state, &js)?;
    if r == "NOT_FOUND" {
        return Err("target_not_found".to_string());
    }
    let xy: Vec<f64> = serde_json::from_str(&r).map_err(|e| e.to_string())?;
    Ok((*xy.first().ok_or("missing x")?, *xy.get(1).ok_or("missing y")?))
}

fn element_center(state: &mut BrowserState, target: &str) -> Result<(f64, f64), String> {
    element_center_via_dom(state, target).or_else(|_| element_center_via_js(state, target))
}

fn autofill_status(state: &mut BrowserState, username_target: &str, password_target: Option<&str>) -> Result<Value, String> {
    let user = serde_json::to_string(username_target).unwrap_or_else(|_| "\"\"".into());
    let pass = serde_json::to_string(password_target.unwrap_or("input[type=password]")).unwrap_or_else(|_| "\"input[type=password]\"".into());
    let js = format!(
        r#"(function(usernameTarget,passwordTarget){{
function vis(e){{try{{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none';}}catch(_){{return false;}}}}
function lab(e){{return (((e.getAttribute&&e.getAttribute('placeholder'))||(e.getAttribute&&e.getAttribute('aria-label'))||e.name||e.id||(e.labels&&e.labels[0]&&e.labels[0].innerText)||'')+'').toLowerCase();}}
function findInput(target,fallback){{let el=null;try{{el=document.querySelector(target);if(el&&!vis(el))el=null;}}catch(_){{}}if(!el){{try{{el=document.querySelector(fallback);if(el&&!vis(el))el=null;}}catch(_){{}}}}if(!el){{const t=(target||'').trim().toLowerCase();const c=[...document.querySelectorAll('input,textarea,[role=textbox],[role=searchbox],[role=combobox]')].filter(vis);el=c.find(e=>lab(e).includes(t));}}return el;}}
const u=findInput(usernameTarget,'input[type=email],input[name=email],input[name=username],input[id=identifierId]');
let p=null;try{{p=document.querySelector(passwordTarget);}}catch(_){{}}if(p&&!vis(p))p=null;if(!p){{try{{p=document.querySelector('input[type=password]');}}catch(_){{}}}}
// Security invariant: this code never reads or returns the password value. It only checks whether the browser filled a non-empty password field.
return JSON.stringify({{usernameFilled:!!(u&&('value' in u)&&u.value.length>0),passwordNonEmpty:!!(p&&('value' in p)&&p.value.length>0),url:location.href,domain:location.hostname}});
}})({},{})"#,
        user, pass
    );
    let r = eval(state, &js)?;
    serde_json::from_str(&r).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_autofill_login(username_field_target: String, password_field_target: Option<String>) -> Result<String, String> {
    with_browser(|s| {
        let (x, y) = element_center(s, &username_field_target)?;
        cdp(s, "Input.dispatchMouseEvent", json!({ "type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1 }))?;
        cdp(s, "Input.dispatchMouseEvent", json!({ "type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1 }))?;
        std::thread::sleep(Duration::from_millis(500));
        let mut status = autofill_status(s, &username_field_target, password_field_target.as_deref())?;
        let filled = status.get("usernameFilled").and_then(|v| v.as_bool()).unwrap_or(false)
            || status.get("passwordNonEmpty").and_then(|v| v.as_bool()).unwrap_or(false);
        if !filled {
            dispatch_key(s, "ArrowDown").ok();
            std::thread::sleep(Duration::from_millis(120));
            dispatch_key(s, "Enter").ok();
            std::thread::sleep(Duration::from_millis(700));
            status = autofill_status(s, &username_field_target, password_field_target.as_deref())?;
        }
        let filled = status.get("usernameFilled").and_then(|v| v.as_bool()).unwrap_or(false)
            || status.get("passwordNonEmpty").and_then(|v| v.as_bool()).unwrap_or(false);
        status["status"] = json!(if filled { "filled" } else { "not_filled" });
        Ok(status.to_string())
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
pub async fn browser_wait(text: Option<String>, selector: Option<String>, seconds: Option<u64>) -> Result<String, String> {
    let max = seconds.unwrap_or(20).min(120);
    if let Some(sel) = selector.filter(|s| !s.trim().is_empty()) {
        return with_browser(|s| {
            let q = serde_json::to_string(&sel).unwrap_or_else(|_| "\"\"".into());
            let expr = format!("!!document.querySelector({})", q);
            let start = Instant::now();
            loop {
                if eval_across_frames(s, &expr).unwrap_or_default() == "true" {
                    return Ok(format!("Selector \"{}\" appeared on the page", sel));
                }
                if start.elapsed() > Duration::from_secs(max) {
                    return Ok(format!("Waited {}s; selector \"{}\" did not appear yet", max, sel));
                }
                std::thread::sleep(Duration::from_millis(800));
            }
        });
    }
    match text {
        Some(t) if !t.trim().is_empty() => with_browser(|s| {
            let needle = serde_json::to_string(&t.to_lowercase()).unwrap_or_else(|_| "\"\"".into());
            let expr = format!(
                "!!(document.body && document.body.innerText.toLowerCase().includes({}))",
                needle
            );
            let start = Instant::now();
            loop {
                if eval_across_frames(s, &expr).unwrap_or_default() == "true" {
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
        let _ = cdp_root(&mut st, "Browser.close", json!({}));
    }
    Ok(())
}

/// Staging directory CDP downloads land in before we move them to their final home.
fn download_staging_dir() -> String {
    let dir = agent_profile_dir("Downloads");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Snapshot of completed files currently in a directory (ignores in-progress
/// Chrome `.crdownload` temp files).
fn completed_files(dir: &str) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".crdownload") {
                set.insert(name);
            }
        }
    }
    set
}

/// Extract a table on the page as TSV text (header + rows). Falls back to NOT_FOUND
/// so the executor can degrade to a plain read.
#[tauri::command]
pub async fn browser_extract_table(selector: Option<String>) -> Result<String, String> {
    with_browser(|s| {
        let q = serde_json::to_string(&selector.clone().unwrap_or_default()).unwrap_or_else(|_| "\"\"".into());
        let js = format!(
            r#"(function(sel){{
function vis(e){{try{{const r=e.getBoundingClientRect();return r.width>1&&r.height>1;}}catch(_){{return true;}}}}
let t=null;
if(sel){{try{{t=document.querySelector(sel);}}catch(_){{}}}}
if(!t){{const all=[...document.querySelectorAll('table')].filter(vis);t=all.sort((a,b)=>b.rows.length-a.rows.length)[0];}}
if(!t)return 'NOT_FOUND';
const rows=[...t.rows].map(r=>[...r.cells].map(c=>(c.innerText||'').replace(/\t/g,' ').replace(/\s+/g,' ').trim()).join('\t'));
return rows.join('\n');}})({})"#,
            q
        );
        let r = eval_across_frames(s, &js)?;
        if r == "NOT_FOUND" {
            return Err("No table was found on the page".to_string());
        }
        Ok(r)
    })
}

/// Download a file through the browser. Sets the CDP download behaviour to a staging
/// dir, triggers the download (navigating to `url`, or relying on a download the page
/// just started), waits for the file to complete, then moves/renames it to its final
/// location. Returns the absolute final path so the agent can verify it.
#[tauri::command]
pub async fn browser_download(
    url: Option<String>,
    target: Option<String>,
    save_as: Option<String>,
) -> Result<String, String> {
    let staging = download_staging_dir();
    let before = completed_files(&staging);

    with_browser(|s| {
        // Route downloads to our staging dir and allow them to proceed without a prompt.
        cdp_root(
            s,
            "Browser.setDownloadBehavior",
            json!({ "behavior": "allow", "downloadPath": staging, "eventsEnabled": true }),
        )
        .or_else(|_| {
            cdp(
                s,
                "Page.setDownloadBehavior",
                json!({ "behavior": "allow", "downloadPath": staging }),
            )
        })?;

        // Trigger the download. When a url is given we click a synthetic <a download>;
        // otherwise we assume the page already started one (e.g. after browser.click).
        if let Some(u) = &url {
            let uj = serde_json::to_string(u).unwrap_or_else(|_| "\"\"".into());
            let js = format!(
                "(function(u){{const a=document.createElement('a');a.href=u;a.download='';a.style.display='none';document.body.appendChild(a);a.click();setTimeout(()=>a.remove(),1000);return 'TRIGGERED';}})({})",
                uj
            );
            eval(s, &js)?;
        }
        Ok(())
    })?;

    // Poll the staging dir for a newly completed file (up to ~60s).
    let deadline = Instant::now() + Duration::from_secs(60);
    let new_file = loop {
        let now_files = completed_files(&staging);
        if let Some(name) = now_files.difference(&before).next() {
            // Ensure it is no longer being written (size stable / no sibling .crdownload).
            let crdownload = std::path::Path::new(&staging).join(format!("{name}.crdownload"));
            if !crdownload.exists() {
                break Some(name.clone());
            }
        }
        if Instant::now() > deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(500));
    };

    let Some(name) = new_file else {
        return Err("download_did_not_complete: no new file appeared in the download folder".to_string());
    };

    let src = std::path::Path::new(&staging).join(&name);

    // Decide the final destination from target (dir or full path) + save_as (filename).
    let final_path: std::path::PathBuf = match (target.as_deref(), save_as.as_deref()) {
        (Some(t), Some(fname)) => std::path::Path::new(t).join(fname),
        (Some(t), None) => {
            let p = std::path::Path::new(t);
            // A path with an extension is treated as a full file path; otherwise a dir.
            if p.extension().is_some() && !p.is_dir() {
                p.to_path_buf()
            } else {
                p.join(&name)
            }
        }
        (None, Some(fname)) => std::path::Path::new(&staging).join(fname),
        (None, None) => src.clone(),
    };

    if final_path != src {
        if let Some(parent) = final_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("download_mkdir_failed: {e}"))?;
        }
        // Rename within a volume, fall back to copy+remove across volumes.
        if std::fs::rename(&src, &final_path).is_err() {
            std::fs::copy(&src, &final_path).map_err(|e| format!("download_move_failed: {e}"))?;
            let _ = std::fs::remove_file(&src);
        }
    }

    Ok(format!("Downloaded to {}", final_path.to_string_lossy()))
}

/// Upload a local file into a page's file input over CDP (`DOM.setFileInputFiles`),
/// which needs no mouse. `target` is the file input's css selector (optional — the
/// first visible file input is used when omitted).
#[tauri::command]
pub async fn browser_upload(target: Option<String>, path: String) -> Result<String, String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("upload_source_missing: {path}"));
    }
    with_browser(|s| {
        let doc = cdp(s, "DOM.getDocument", json!({ "depth": 0 }))?;
        let root = doc
            .get("root")
            .and_then(|r| r.get("nodeId"))
            .and_then(|n| n.as_i64())
            .ok_or("could not read document root")?;

        let selector = match &target {
            Some(t) if !t.trim().is_empty() => t.clone(),
            _ => "input[type=file]".to_string(),
        };
        let found = cdp(s, "DOM.querySelector", json!({ "nodeId": root, "selector": selector }))?;
        let node_id = found
            .get("nodeId")
            .and_then(|n| n.as_i64())
            .filter(|n| *n != 0)
            .ok_or_else(|| format!("No file input matching \"{selector}\" was found on the page"))?;

        cdp(
            s,
            "DOM.setFileInputFiles",
            json!({ "nodeId": node_id, "files": [path] }),
        )?;
        Ok(format!("Uploaded {path}"))
    })
}
