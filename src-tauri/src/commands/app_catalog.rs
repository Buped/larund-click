//! Curated catalog of well-known Windows applications with deterministic launch
//! recipes.
//!
//! This is the OpenClaw-style "skill/recipe registry": instead of fuzzy-matching
//! dynamically enumerated Start Menu entries on every request (slow and ambiguous —
//! the cause of "the agent never finds the app on the first try"), the common apps
//! resolve to an exact, ordered set of launch strategies. The desktop layer then
//! tries them in order and verifies the window actually appeared.
//!
//! The catalog itself is platform-independent data; the resolution + verification of
//! each [`LaunchCandidate`] lives in `desktop.rs` (Windows-only).

/// One way to launch an app. The desktop layer tries an app's candidates in order
/// until one produces a verified window.
#[derive(Clone, Debug)]
pub enum LaunchCandidate {
    /// Resolve the canonical executable via the Windows "App Paths" registry key
    /// (version-independent — the OS records where the exe lives), then run it with
    /// `args`.
    AppPaths {
        exe: &'static str,
        args: &'static str,
    },
    /// Probe absolute paths in order; the first one that exists wins. Run with `args`.
    ExeProbe {
        paths: &'static [&'static str],
        args: &'static str,
    },
    /// Locate a Start Menu shortcut named `<name>.lnk` and launch it.
    Shortcut { name: &'static str },
    /// Run a bare command/verb expected to be on PATH or handled by the shell
    /// (e.g. "soffice --calc", "ms-settings:", "explorer.exe", "calc").
    PathCommand { command: &'static str },
}

/// How to confirm an app actually started after a launch.
#[derive(Clone, Debug)]
pub struct VerifyHint {
    /// Process names (without `.exe`, matched case-insensitively).
    pub processes: &'static [&'static str],
    /// Substrings (matched case-insensitively) expected in the new window's title.
    pub title_contains: &'static [&'static str],
}

/// A curated, well-known application.
#[derive(Clone, Debug)]
pub struct KnownApp {
    pub id: &'static str,
    pub display_name: &'static str,
    /// Natural-language names the user/agent might use (English + Hungarian).
    pub aliases: &'static [&'static str],
    /// Ordered launch strategies, tried until one verifies.
    pub launch: &'static [LaunchCandidate],
    pub verify: VerifyHint,
}

/// Normalise a name for matching: lowercase, non-alphanumerics → spaces, collapse
/// whitespace. Unicode-aware so Hungarian accents are preserved.
fn normalize(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Find the best curated app for a free-text query. Returns `None` when nothing
/// matches confidently, so the caller can fall back to dynamic enumeration.
pub fn match_known_app(query: &str) -> Option<&'static KnownApp> {
    let q = normalize(query);
    if q.is_empty() {
        return None;
    }

    let mut best: Option<(&'static KnownApp, f32)> = None;
    for app in CATALOG {
        let mut score = 0.0f32;
        for alias in app.aliases {
            let a = normalize(alias);
            if a.is_empty() {
                continue;
            }
            let candidate = if a == q {
                1.0
            } else if q.starts_with(&a) || a.starts_with(&q) {
                // Prefer a longer shared prefix.
                let ratio = a.len().min(q.len()) as f32 / a.len().max(q.len()) as f32;
                0.80 + ratio * 0.15
            } else if a.contains(&q) || q.contains(&a) {
                0.60
            } else {
                0.0
            };
            if candidate > score {
                score = candidate;
            }
        }
        if score > 0.0 {
            match best {
                Some((_, bs)) if bs >= score => {}
                _ => best = Some((app, score)),
            }
        }
    }

    best.filter(|(_, s)| *s >= 0.60).map(|(app, _)| app)
}

// ─── The catalog ────────────────────────────────────────────────────────────────
// Keep launch candidates ordered most-specific/most-reliable first. App Paths is the
// preferred resolver because it is version-independent.

const LIBRE_CALC_PATHS: &[&str] = &[
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

const EXCEL_PATHS: &[&str] = &[
    "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE",
    "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\EXCEL.EXE",
    "C:\\Program Files\\Microsoft Office\\Office16\\EXCEL.EXE",
    "C:\\Program Files (x86)\\Microsoft Office\\Office16\\EXCEL.EXE",
];

const WORD_PATHS: &[&str] = &[
    "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    "C:\\Program Files\\Microsoft Office\\Office16\\WINWORD.EXE",
];

const POWERPOINT_PATHS: &[&str] = &[
    "C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE",
    "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE",
];

const NOTEPAD_PATHS: &[&str] = &[
    "C:\\Windows\\System32\\notepad.exe",
    "C:\\Windows\\notepad.exe",
];

const WORDPAD_PATHS: &[&str] = &[
    "C:\\Program Files\\Windows NT\\Accessories\\wordpad.exe",
    "C:\\Program Files (x86)\\Windows NT\\Accessories\\wordpad.exe",
];

const CHROME_PATHS: &[&str] = &[
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const FIREFOX_PATHS: &[&str] = &[
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
];

pub static CATALOG: &[KnownApp] = &[
    // ── LibreOffice suite ──
    KnownApp {
        id: "libreoffice_calc",
        display_name: "LibreOffice Calc",
        aliases: &[
            "libreoffice calc", "libre office calc", "calc", "spreadsheet",
            "táblázat", "tablazat", "táblázatkezelő", "tablazatkezelo",
            "libreoffice táblázat", "libreoffice spreadsheet",
        ],
        launch: &[
            LaunchCandidate::AppPaths { exe: "soffice.exe", args: "--calc" },
            LaunchCandidate::ExeProbe { paths: LIBRE_CALC_PATHS, args: "--calc" },
            LaunchCandidate::Shortcut { name: "LibreOffice Calc" },
            LaunchCandidate::PathCommand { command: "soffice --calc" },
        ],
        verify: VerifyHint { processes: &["soffice"], title_contains: &["Calc"] },
    },
    KnownApp {
        id: "libreoffice_writer",
        display_name: "LibreOffice Writer",
        aliases: &[
            "libreoffice writer", "libre office writer", "writer",
            "szövegszerkesztő", "szovegszerkeszto", "libreoffice szöveg",
        ],
        launch: &[
            LaunchCandidate::AppPaths { exe: "soffice.exe", args: "--writer" },
            LaunchCandidate::ExeProbe { paths: LIBRE_CALC_PATHS, args: "--writer" },
            LaunchCandidate::Shortcut { name: "LibreOffice Writer" },
            LaunchCandidate::PathCommand { command: "soffice --writer" },
        ],
        verify: VerifyHint { processes: &["soffice"], title_contains: &["Writer"] },
    },
    KnownApp {
        id: "libreoffice_impress",
        display_name: "LibreOffice Impress",
        aliases: &["libreoffice impress", "impress", "prezentáció", "prezentacio", "presentation"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "soffice.exe", args: "--impress" },
            LaunchCandidate::ExeProbe { paths: LIBRE_CALC_PATHS, args: "--impress" },
            LaunchCandidate::Shortcut { name: "LibreOffice Impress" },
            LaunchCandidate::PathCommand { command: "soffice --impress" },
        ],
        verify: VerifyHint { processes: &["soffice"], title_contains: &["Impress"] },
    },
    KnownApp {
        id: "libreoffice_draw",
        display_name: "LibreOffice Draw",
        aliases: &["libreoffice draw", "draw", "rajz"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "soffice.exe", args: "--draw" },
            LaunchCandidate::ExeProbe { paths: LIBRE_CALC_PATHS, args: "--draw" },
            LaunchCandidate::Shortcut { name: "LibreOffice Draw" },
            LaunchCandidate::PathCommand { command: "soffice --draw" },
        ],
        verify: VerifyHint { processes: &["soffice"], title_contains: &["Draw"] },
    },
    KnownApp {
        id: "libreoffice_start",
        display_name: "LibreOffice",
        aliases: &["libreoffice", "libre office", "office"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "soffice.exe", args: "" },
            LaunchCandidate::ExeProbe { paths: LIBRE_CALC_PATHS, args: "" },
            LaunchCandidate::Shortcut { name: "LibreOffice" },
            LaunchCandidate::PathCommand { command: "soffice" },
        ],
        verify: VerifyHint { processes: &["soffice"], title_contains: &["LibreOffice"] },
    },
    // ── Microsoft Office ──
    KnownApp {
        id: "ms_excel",
        display_name: "Microsoft Excel",
        aliases: &["excel", "microsoft excel", "ms excel"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "excel.exe", args: "" },
            LaunchCandidate::ExeProbe { paths: EXCEL_PATHS, args: "" },
            LaunchCandidate::Shortcut { name: "Excel" },
        ],
        verify: VerifyHint { processes: &["excel"], title_contains: &["Excel"] },
    },
    KnownApp {
        id: "ms_word",
        display_name: "Microsoft Word",
        aliases: &["word", "microsoft word", "ms word"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "winword.exe", args: "" },
            LaunchCandidate::ExeProbe { paths: WORD_PATHS, args: "" },
            LaunchCandidate::Shortcut { name: "Word" },
        ],
        verify: VerifyHint { processes: &["winword"], title_contains: &["Word"] },
    },
    KnownApp {
        id: "ms_powerpoint",
        display_name: "Microsoft PowerPoint",
        aliases: &["powerpoint", "microsoft powerpoint", "ms powerpoint", "ppt"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "powerpnt.exe", args: "" },
            LaunchCandidate::ExeProbe { paths: POWERPOINT_PATHS, args: "" },
            LaunchCandidate::Shortcut { name: "PowerPoint" },
        ],
        verify: VerifyHint { processes: &["powerpnt"], title_contains: &["PowerPoint"] },
    },
    KnownApp {
        id: "ms_outlook",
        display_name: "Microsoft Outlook",
        aliases: &["outlook", "microsoft outlook", "ms outlook"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "outlook.exe", args: "" },
            LaunchCandidate::Shortcut { name: "Outlook" },
        ],
        verify: VerifyHint { processes: &["outlook"], title_contains: &["Outlook"] },
    },
    // ── Windows built-ins ──
    KnownApp {
        id: "notepad",
        display_name: "Notepad",
        aliases: &["notepad", "jegyzettömb", "jegyzettomb", "jegyzet"],
        launch: &[
            LaunchCandidate::ExeProbe { paths: NOTEPAD_PATHS, args: "" },
            LaunchCandidate::PathCommand { command: "notepad" },
        ],
        verify: VerifyHint { processes: &["notepad"], title_contains: &["Notepad", "Jegyzettömb"] },
    },
    KnownApp {
        id: "wordpad",
        display_name: "WordPad",
        aliases: &["wordpad"],
        launch: &[
            LaunchCandidate::ExeProbe { paths: WORDPAD_PATHS, args: "" },
            LaunchCandidate::PathCommand { command: "write" },
        ],
        verify: VerifyHint { processes: &["wordpad"], title_contains: &["WordPad", "Wordpad"] },
    },
    KnownApp {
        id: "calculator",
        display_name: "Calculator",
        aliases: &["calculator", "számológép", "szamologep"],
        launch: &[LaunchCandidate::PathCommand { command: "calc" }],
        verify: VerifyHint {
            processes: &["calculatorapp", "calculator"],
            title_contains: &["Calculator", "Számológép"],
        },
    },
    KnownApp {
        id: "paint",
        display_name: "Paint",
        aliases: &["paint", "mspaint", "rajzoló", "rajzolo"],
        launch: &[LaunchCandidate::PathCommand { command: "mspaint" }],
        verify: VerifyHint {
            processes: &["mspaint", "paintstudio.view", "paint"],
            title_contains: &["Paint"],
        },
    },
    KnownApp {
        id: "snipping_tool",
        display_name: "Snipping Tool",
        aliases: &["snipping tool", "snip", "képmetsző", "kepmetszo", "screenshot tool"],
        launch: &[LaunchCandidate::PathCommand { command: "snippingtool" }],
        verify: VerifyHint {
            processes: &["snippingtool", "screenclippinghost", "screensketch"],
            title_contains: &["Snipping", "Képmetsző"],
        },
    },
    KnownApp {
        id: "explorer",
        display_name: "File Explorer",
        aliases: &["explorer", "file explorer", "files", "fájlkezelő", "fajlkezelo", "intéző", "intezo"],
        launch: &[LaunchCandidate::PathCommand { command: "explorer.exe" }],
        verify: VerifyHint { processes: &["explorer"], title_contains: &[] },
    },
    KnownApp {
        id: "settings",
        display_name: "Windows Settings",
        aliases: &["settings", "windows settings", "beállítások", "beallitasok", "gépház", "gephaz"],
        launch: &[LaunchCandidate::PathCommand { command: "ms-settings:" }],
        verify: VerifyHint {
            processes: &["systemsettings"],
            title_contains: &["Settings", "Beállítások", "Gépház"],
        },
    },
    KnownApp {
        id: "task_manager",
        display_name: "Task Manager",
        aliases: &["task manager", "taskmgr", "feladatkezelő", "feladatkezelo"],
        launch: &[LaunchCandidate::PathCommand { command: "taskmgr" }],
        verify: VerifyHint {
            processes: &["taskmgr"],
            title_contains: &["Task Manager", "Feladatkezelő"],
        },
    },
    KnownApp {
        id: "cmd",
        display_name: "Command Prompt",
        aliases: &["cmd", "command prompt", "parancssor"],
        launch: &[LaunchCandidate::PathCommand { command: "cmd.exe" }],
        verify: VerifyHint {
            processes: &["cmd"],
            title_contains: &["cmd", "Command Prompt", "Parancssor"],
        },
    },
    KnownApp {
        id: "powershell",
        display_name: "Windows PowerShell",
        aliases: &["powershell", "windows powershell", "ps"],
        launch: &[LaunchCandidate::PathCommand { command: "powershell.exe" }],
        verify: VerifyHint {
            processes: &["powershell", "pwsh", "windowsterminal"],
            title_contains: &["PowerShell"],
        },
    },
    KnownApp {
        id: "windows_terminal",
        display_name: "Windows Terminal",
        aliases: &["terminal", "windows terminal", "wt"],
        launch: &[LaunchCandidate::PathCommand { command: "wt.exe" }],
        verify: VerifyHint {
            processes: &["windowsterminal"],
            title_contains: &["Terminal"],
        },
    },
    // ── Browsers (web tasks still prefer the browser_* tools) ──
    KnownApp {
        id: "chrome",
        display_name: "Google Chrome",
        aliases: &["chrome", "google chrome"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "chrome.exe", args: "" },
            LaunchCandidate::ExeProbe { paths: CHROME_PATHS, args: "" },
        ],
        verify: VerifyHint { processes: &["chrome"], title_contains: &["Chrome"] },
    },
    KnownApp {
        id: "edge",
        display_name: "Microsoft Edge",
        aliases: &["edge", "microsoft edge", "msedge"],
        launch: &[LaunchCandidate::AppPaths { exe: "msedge.exe", args: "" }],
        verify: VerifyHint { processes: &["msedge"], title_contains: &["Edge"] },
    },
    KnownApp {
        id: "firefox",
        display_name: "Mozilla Firefox",
        aliases: &["firefox", "mozilla firefox", "mozilla"],
        launch: &[
            LaunchCandidate::AppPaths { exe: "firefox.exe", args: "" },
            LaunchCandidate::ExeProbe { paths: FIREFOX_PATHS, args: "" },
        ],
        verify: VerifyHint { processes: &["firefox"], title_contains: &["Firefox", "Mozilla"] },
    },
];
