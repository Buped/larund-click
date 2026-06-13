//! Input arbitration for Agent Mode.
//!
//! While the agent drives the mouse/keyboard on the real desktop we install
//! Win32 low-level hooks so that:
//!   * a physical **ESC** key-down always stops the agent (works even when the
//!     chat window is minimised — it's a global hook, not a focused shortcut), and
//!   * the user's **physical mouse** (and stray key presses) are swallowed *only*
//!     while the AI is mid-action (`BLOCK_INPUT`), so the user can't fight the
//!     cursor — but the mouse is free between actions.
//!
//! Our synthetic input (enigo `SendInput`) carries the INJECTED flag, so the
//! hooks let it through and only suppress real, user-generated input.
//!
//! Safety: Ctrl+Alt+Del is unaffected by low-level hooks. A watchdog clears
//! `BLOCK_INPUT` if it is ever stuck on for more than a few seconds, and the
//! hooks die automatically if the process exits — so the user can never be
//! permanently locked out.

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::thread::JoinHandle;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tauri::{AppHandle, Emitter};
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT, LLKHF_INJECTED,
        LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_QUIT,
        WM_SYSKEYDOWN,
    };

    const VK_ESCAPE: u32 = 0x1B;
    /// Maximum time the physical input may stay blocked before the watchdog
    /// force-clears it. No single AI action should take anywhere near this long.
    const MAX_BLOCK_MS: u64 = 5_000;

    static HOOKS_RUNNING: AtomicBool = AtomicBool::new(false);
    static GUARD_ON: AtomicBool = AtomicBool::new(false);
    static BLOCK_INPUT: AtomicBool = AtomicBool::new(false);
    static ABORTED: AtomicBool = AtomicBool::new(false);
    static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
    static BLOCK_SINCE_MS: AtomicU64 = AtomicU64::new(0);

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static THREADS: OnceLock<Mutex<Vec<JoinHandle<()>>>> = OnceLock::new();

    fn threads() -> &'static Mutex<Vec<JoinHandle<()>>> {
        THREADS.get_or_init(|| Mutex::new(Vec::new()))
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && GUARD_ON.load(Ordering::SeqCst) {
            let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
            let injected = kb.flags & LLKHF_INJECTED != 0;
            if !injected {
                let is_keydown =
                    wparam == WM_KEYDOWN as usize || wparam == WM_SYSKEYDOWN as usize;
                if is_keydown && kb.vkCode == VK_ESCAPE {
                    ABORTED.store(true, Ordering::SeqCst);
                    if let Some(app) = APP.get() {
                        let _ = app.emit("agent-input-abort", ());
                    }
                    return 1; // swallow the ESC
                }
                // While the AI is acting, swallow real keys so they don't merge
                // into the AI's typing.
                if BLOCK_INPUT.load(Ordering::SeqCst) {
                    return 1;
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32
            && GUARD_ON.load(Ordering::SeqCst)
            && BLOCK_INPUT.load(Ordering::SeqCst)
        {
            let ms = &*(lparam as *const MSLLHOOKSTRUCT);
            let injected = ms.flags & LLMHF_INJECTED != 0;
            if !injected {
                return 1; // swallow the user's physical mouse during an AI burst
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    fn run_hook_thread() {
        unsafe {
            let hmod = GetModuleHandleW(std::ptr::null());
            let kb: HHOOK = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), hmod, 0);
            let ms: HHOOK = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hmod, 0);
            HOOK_THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);

            let mut msg: MSG = std::mem::zeroed();
            // GetMessageW returns 0 on WM_QUIT, which our stop() posts to this thread.
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if !kb.is_null() {
                UnhookWindowsHookEx(kb);
            }
            if !ms.is_null() {
                UnhookWindowsHookEx(ms);
            }
        }
    }

    fn run_watchdog() {
        while HOOKS_RUNNING.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(500));
            if BLOCK_INPUT.load(Ordering::SeqCst) {
                let since = BLOCK_SINCE_MS.load(Ordering::SeqCst);
                if now_ms().saturating_sub(since) > MAX_BLOCK_MS {
                    BLOCK_INPUT.store(false, Ordering::SeqCst);
                }
            }
        }
    }

    pub fn start(app: AppHandle) {
        let _ = APP.set(app);
        GUARD_ON.store(true, Ordering::SeqCst);
        BLOCK_INPUT.store(false, Ordering::SeqCst);

        if HOOKS_RUNNING.swap(true, Ordering::SeqCst) {
            return; // already running — flags re-armed above; keep any pending abort
        }
        ABORTED.store(false, Ordering::SeqCst); // fresh start clears any prior abort

        let hook = std::thread::spawn(run_hook_thread);
        let watch = std::thread::spawn(run_watchdog);
        let mut guard = threads().lock().unwrap();
        guard.push(hook);
        guard.push(watch);
    }

    pub fn stop() {
        // Clear the abort flag first so it never leaks into the next task
        // (including CLI tasks that never start the guard and return early below).
        ABORTED.store(false, Ordering::SeqCst);
        GUARD_ON.store(false, Ordering::SeqCst);
        BLOCK_INPUT.store(false, Ordering::SeqCst);
        if !HOOKS_RUNNING.swap(false, Ordering::SeqCst) {
            return;
        }
        let tid = HOOK_THREAD_ID.swap(0, Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                PostThreadMessageW(tid, WM_QUIT, 0, 0);
            }
        }
        if let Ok(mut guard) = threads().lock() {
            for handle in guard.drain(..) {
                let _ = handle.join();
            }
        }
    }

    pub fn set_block(on: bool) {
        if on {
            BLOCK_SINCE_MS.store(now_ms(), Ordering::SeqCst);
        }
        BLOCK_INPUT.store(on, Ordering::SeqCst);
    }

    pub fn pause() {
        GUARD_ON.store(false, Ordering::SeqCst);
        BLOCK_INPUT.store(false, Ordering::SeqCst);
    }

    pub fn resume() {
        if HOOKS_RUNNING.load(Ordering::SeqCst) {
            GUARD_ON.store(true, Ordering::SeqCst);
        }
    }

    pub fn aborted() -> bool {
        ABORTED.load(Ordering::SeqCst)
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use tauri::AppHandle;
    pub fn start(_app: AppHandle) {}
    pub fn stop() {}
    pub fn set_block(_on: bool) {}
    pub fn pause() {}
    pub fn resume() {}
    pub fn aborted() -> bool {
        false
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Installs the input hooks and arms ESC-to-stop. Idempotent.
#[tauri::command]
pub async fn input_guard_start(app: tauri::AppHandle) -> Result<(), String> {
    imp::start(app);
    Ok(())
}

/// Uninstalls the hooks and clears all state.
#[tauri::command]
pub async fn input_guard_stop() -> Result<(), String> {
    imp::stop();
    Ok(())
}

/// Blocks/unblocks the user's physical input. Called around each AI action burst.
#[tauri::command]
pub async fn input_guard_set_block(on: bool) -> Result<(), String> {
    imp::set_block(on);
    Ok(())
}

/// Temporarily disarms the guard (e.g. while asking the user a question) so the
/// user can type and use the mouse freely.
#[tauri::command]
pub async fn input_guard_pause() -> Result<(), String> {
    imp::pause();
    Ok(())
}

/// Re-arms the guard after a pause.
#[tauri::command]
pub async fn input_guard_resume() -> Result<(), String> {
    imp::resume();
    Ok(())
}

/// Returns whether a stop (ESC) has been requested since the last start.
#[tauri::command]
pub async fn input_guard_poll() -> Result<bool, String> {
    Ok(imp::aborted())
}
