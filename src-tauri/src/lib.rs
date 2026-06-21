mod artifacts;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Loopback OAuth: starts a localhost server that captures the provider
        // redirect (http://localhost:<port>/) so a user can connect their own
        // account with one click. See src/lib/connections/oauth/loopback.ts.
        .plugin(tauri_plugin_oauth::init())
        // NO-MOUSE CORE: the agent tool surface below deliberately excludes every
        // mouse / cursor / screenshot / SOC / OCR / UIA-click / grid / border /
        // virtual-desktop / input-guard command. Those Rust functions still exist
        // in `commands::agent` (compiled but unreachable) and are intentionally NOT
        // registered here, so nothing — not the agent core, not the UI — can invoke
        // them. See docs/NO_MOUSE_CORE.md and docs/MIGRATION_FROM_VISUAL.md.
        .invoke_handler(tauri::generate_handler![
            // ── runtime / shell ──────────────────────────────────────────────
            commands::agent::shell_run,
            commands::process::process_start,
            commands::process::process_status,
            commands::process::process_kill,
            // ── files ────────────────────────────────────────────────────────
            commands::agent::file_read,
            commands::agent::file_write,
            commands::agent::dir_list,
            commands::fs_ops::fs_mkdir,
            commands::fs_ops::fs_copy,
            commands::fs_ops::fs_move,
            commands::fs_ops::fs_delete,
            commands::fs_ops::fs_exists,
            commands::fs_ops::fs_metadata,
            commands::fs_ops::fs_tree,
            commands::fs_ops::fs_search,
            // ── data (spreadsheets) ──────────────────────────────────────────
            commands::agent::sheet_read,
            commands::agent::sheet_write,
            commands::documents::document_extract_text,
            commands::documents::document_extract_rich,
            commands::documents::docx_write,
            commands::documents::file_write_bytes,
            commands::documents::file_read_bytes,
            commands::documents::file_read_base64,
            // ── local artifacts / document generation ───────────────────────
            artifacts::artifact_render_pdf,
            artifacts::artifact_render_docx,
            artifacts::artifact_render_pptx,
            artifacts::artifact_convert,
            artifacts::artifact_preview,
            artifacts::artifact_verify,
            artifacts::artifact_design_lint,
            artifacts::artifact_get_source_model,
            artifacts::artifact_list,
            artifacts::artifact_open,
            artifacts::artifact_show_in_folder,
            artifacts::artifact_save_copy,
            artifacts::artifact_get_file_bytes,
            artifacts::artifact_get_preview_bytes,
            artifacts::artifact_get_manifest,
            artifacts::artifact_get_text,
            artifacts::artifact_copy_to,
            artifacts::artifact_pdf_merge,
            artifacts::artifact_pdf_split,
            artifacts::artifact_pdf_watermark,
            artifacts::artifact_pdf_extract_text,
            artifacts::artifact_pdf_metadata,
            artifacts::artifact_pdf_page_count,
            // ── clipboard ────────────────────────────────────────────────────
            commands::agent::clipboard_get,
            commands::agent::clipboard_set,
            // ── apps / windows / keyboard (no-mouse: launch + focus + keys) ──
            commands::agent::app_open,
            commands::agent::desktop_list_apps,
            commands::agent::desktop_open_app,
            commands::agent::get_window_list,
            commands::agent::focus_window,
            commands::agent::type_text,
            commands::agent::key_press,
            commands::agent::key_combo,
            commands::agent::send_notification,
            // ── browser (DOM/CDP automation — the GUI substitute) ────────────
            commands::browser::browser_open,
            commands::browser::browser_click,
            commands::browser::browser_type,
            commands::browser::browser_read,
            commands::browser::browser_key,
            commands::browser::browser_shortcut,
            commands::browser::browser_wait,
            commands::browser::browser_extract_table,
            commands::browser::browser_download,
            commands::browser::browser_upload,
            commands::browser::browser_probe,
            commands::browser::browser_close,
            // ── network (CORS-free HTTP for OAuth token exchange, etc.) ──────
            commands::net::http_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
