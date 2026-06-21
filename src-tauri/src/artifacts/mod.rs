pub mod docx;
pub mod font;
pub mod invoice;
pub mod libreoffice;
pub mod pdf;
pub mod pptx;
pub mod preview;
pub mod storage;

use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use storage::{expand_tilde, file_entry, manifest, new_artifact_dir, sanitize_part, save_manifest, write_json};
use zip::ZipArchive;

fn make_output_name(title: &str, provided: Option<String>, ext: &str) -> String {
    provided
        .map(|name| sanitize_part(name.trim_end_matches(&format!(".{ext}")), "artifact"))
        .unwrap_or_else(|| sanitize_part(title, "artifact"))
        + "."
        + ext
}

fn verification_for(path: &Path, expected_text: Vec<String>, expected_kind: Option<String>) -> Value {
    let exists = path.exists();
    let mut errors = Vec::<String>::new();
    let mut warnings = Vec::<String>::new();
    if !exists {
        errors.push("file_missing".to_string());
    }
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if exists && size == 0 {
        errors.push("file_empty".to_string());
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if let Some(kind) = expected_kind.as_deref() {
        if kind != ext {
            warnings.push(format!("expected_kind_{kind}_but_extension_is_{ext}"));
        }
    }
    let text = extract_text(path).unwrap_or_default();
    let contains = expected_text
        .into_iter()
        .filter(|needle| !needle.trim().is_empty() && text.to_lowercase().contains(&needle.to_lowercase()))
        .collect::<Vec<_>>();
    let page_count = if ext == "pdf" { pdf::page_count(path) } else { 0 };
    let slide_count = if ext == "pptx" { count_pptx_slides(path) } else { 0 };
    json!({
        "exists": exists,
        "readable": exists && size > 0 && errors.is_empty(),
        "pageCount": if page_count > 0 { json!(page_count) } else { Value::Null },
        "slideCount": if slide_count > 0 { json!(slide_count) } else { Value::Null },
        "wordCount": text.split_whitespace().count(),
        "containsExpectedText": contains,
        "warnings": warnings,
        "errors": errors,
    })
}

fn is_invoice_model(model: &Value) -> bool {
    if model.get("kind").and_then(Value::as_str) == Some("invoice") {
        return true;
    }
    model.get("invoiceNumber").is_some() && model.get("lineItems").and_then(Value::as_array).map(|a| !a.is_empty()).unwrap_or(false)
}

const HU_ACCENTS: &[char] = &[
    'á', 'é', 'í', 'ó', 'ö', 'ő', 'ú', 'ü', 'ű', 'Á', 'É', 'Í', 'Ó', 'Ö', 'Ő', 'Ú', 'Ü', 'Ű',
];

/// Design + content quality gate for a rendered document. Returns a structured
/// report; the completion guard refuses `task.complete` while `status` is `fail`.
fn design_lint_report(path: &Path, kind: &str, model: &Value) -> Value {
    let mut checks: Vec<Value> = Vec::new();
    let mut push = |id: &str, ok: bool, severity: &str, detail: &str| {
        checks.push(json!({ "id": id, "ok": ok, "severity": severity, "detail": detail }));
    };

    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    push("file_nonempty", size > 2000, "fail", &format!("output is {size} bytes (a real designed document is well over 2 KB)"));

    let bytes = std::fs::read(path).unwrap_or_default();
    let raw = String::from_utf8_lossy(&bytes);
    let font_embedded = raw.contains("FontFile2") || raw.contains("FontFile3") || kind != "pdf";
    push("font_embedded", font_embedded, "fail", "PDF must embed a font (FontFile2) so accents render and copy correctly");

    let text = extract_text(path).unwrap_or_default();
    let language = model.get("language").and_then(Value::as_str).unwrap_or("hu");

    let title_present = model.get("title").and_then(Value::as_str).map(|t| !t.is_empty()).unwrap_or(false)
        || model.get("invoiceNumber").and_then(Value::as_str).map(|t| !t.is_empty()).unwrap_or(false);
    push("has_title", title_present, "warn", "document should carry a title or invoice number");

    let is_invoice = is_invoice_model(model) || kind == "invoice";
    if is_invoice {
        let items = model.get("lineItems").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
        push("invoice_line_items", items >= 1, "fail", "invoice needs at least one line item");
        let has_totals = text.to_lowercase().contains("fizetendő") || model.get("totals").is_some();
        push("invoice_totals", has_totals, "fail", "invoice needs a totals / amount-due section");
        for word in ["Számla", "Fizetendő", "Kibocsátó", "ÁFA"] {
            let ok = text.to_lowercase().contains(&word.to_lowercase());
            push("invoice_anchor", ok, "fail", &format!("expected accent-safe label '{word}' in extracted text"));
        }
    } else {
        let blocks = model.get("sections").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
        push("structured_blocks", blocks >= 3, "warn", "designed document should have at least 3 structured sections");
    }

    if language.starts_with("hu") {
        let has_accent = text.chars().any(|c| HU_ACCENTS.contains(&c));
        // U+FFFD or stray control bytes indicate a broken (non-embedded-font) encoding.
        let mojibake = text.contains('\u{FFFD}');
        push("accents_present", has_accent, "fail", "Hungarian document must contain accented characters (áéíóöőúüű) in extracted text");
        push("no_mojibake", !mojibake, "fail", "extracted text contains replacement characters — encoding is broken");
    }

    let template = model.get("templateId").and_then(Value::as_str).map(|t| !t.is_empty()).unwrap_or(false)
        || model.get("themeId").and_then(Value::as_str).map(|t| !t.is_empty()).unwrap_or(false)
        || is_invoice;
    push("template_or_theme", template, "warn", "designed-by-default documents should declare a template or theme id");

    let failed: Vec<&Value> = checks.iter().filter(|c| c["ok"] == json!(false) && c["severity"] == json!("fail")).collect();
    let warned: Vec<&Value> = checks.iter().filter(|c| c["ok"] == json!(false) && c["severity"] == json!("warn")).collect();
    let status = if !failed.is_empty() { "fail" } else if !warned.is_empty() { "warn" } else { "pass" };
    json!({
        "status": status,
        "failures": failed.iter().map(|c| c["id"].clone()).collect::<Vec<_>>(),
        "warnings": warned.iter().map(|c| c["id"].clone()).collect::<Vec<_>>(),
        "checks": checks,
    })
}

fn strip_xml_text(xml: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in xml.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_zip_text(path: &Path, wanted: impl Fn(&str) -> bool) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("zip_read_failed:{}: {e}", path.display()))?;
    let mut archive = ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("zip_open_failed: {e}"))?;
    let mut parts = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if wanted(&name) {
            let mut xml = String::new();
            file.read_to_string(&mut xml).map_err(|e| format!("zip_xml_read_failed:{name}: {e}"))?;
            parts.push(strip_xml_text(&xml));
        }
    }
    Ok(parts.join("\n"))
}

fn extract_text(path: &Path) -> Result<String, String> {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "pdf" => pdf::extract_pdf_text(path),
        "docx" => extract_zip_text(path, |name| name == "word/document.xml" || name.starts_with("word/header") || name.starts_with("word/footer")),
        "pptx" => extract_zip_text(path, |name| name.starts_with("ppt/slides/slide") && name.ends_with(".xml")),
        "html" | "md" | "txt" | "csv" => std::fs::read_to_string(path).map_err(|e| format!("text_read_failed:{}: {e}", path.display())),
        ext => Err(format!("unsupported_extract_format:{ext}")),
    }
}

fn count_pptx_slides(path: &Path) -> usize {
    let Ok(bytes) = std::fs::read(path) else { return 0 };
    let Ok(mut archive) = ZipArchive::new(std::io::Cursor::new(bytes)) else { return 0 };
    let mut count = 0;
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name();
            if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
                count += 1;
            }
        }
    }
    count
}

fn finish_artifact(
    id: String,
    dir: PathBuf,
    title: String,
    kind: &str,
    template_id: Option<String>,
    source_path: PathBuf,
    source_mime: &str,
    output_path: PathBuf,
    output_mime: &str,
    preview_path: PathBuf,
    verification: Value,
) -> Result<String, String> {
    let manifest_value = manifest(
        &id,
        &title,
        kind,
        template_id,
        vec![file_entry(&source_path, source_path.file_name().and_then(|s| s.to_str()).unwrap_or("source"), source_mime, "source")],
        vec![file_entry(&output_path, output_path.file_name().and_then(|s| s.to_str()).unwrap_or("output"), output_mime, "output")],
        vec![file_entry(&preview_path, "thumbnail.png", "image/png", "preview")],
        verification,
    );
    save_manifest(&dir, &manifest_value)?;
    serde_json::to_string_pretty(&manifest_value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn artifact_render_pdf(
    title: String,
    model: Value,
    template_id: Option<String>,
    output_name: Option<String>,
    options: Option<Value>,
) -> Result<String, String> {
    let _ = options;
    let (id, dir) = new_artifact_dir(&title)?;
    let source_path = dir.join("source").join("document.json");
    write_json(&source_path, &model)?;
    let output_path = dir.join("output").join(make_output_name(&title, output_name, "pdf"));
    let is_invoice = is_invoice_model(&model);
    let resolved_template = if is_invoice {
        template_id.clone().or_else(|| Some("invoice-blue-premium".to_string()))
    } else {
        template_id.clone()
    };
    let expected_text = if is_invoice {
        // Accent-safe Hungarian invoice anchors; verification fails loudly if the
        // embedded font path regresses and these words come back as mojibake.
        let mut anchors = vec![
            "Számla".to_string(),
            "Kibocsátó".to_string(),
            "Vevő".to_string(),
            "Fizetendő".to_string(),
            "ÁFA".to_string(),
        ];
        if let Some(no) = model.get("invoiceNumber").and_then(Value::as_str) {
            if !no.is_empty() {
                anchors.push(no.to_string());
            }
        }
        anchors
    } else {
        vec![title.clone()]
    };
    if is_invoice {
        invoice::write_invoice_pdf(&output_path, &model)?;
    } else {
        let html = pdf::render_html(&model, resolved_template.as_deref());
        let html_path = dir.join("output").join(make_output_name(&title, None, "html"));
        std::fs::write(&html_path, html).map_err(|e| format!("html_write_failed: {e}"))?;
        pdf::write_pdf(&output_path, &model)?;
    }
    let preview_path = dir.join("preview").join("thumbnail.png");
    preview::write_thumbnail(&preview_path, &title, "pdf")?;
    let verification = verification_for(&output_path, expected_text, Some("pdf".to_string()));
    finish_artifact(id, dir, title, "pdf", resolved_template, source_path, "application/json", output_path, "application/pdf", preview_path, verification)
}

#[tauri::command]
pub async fn artifact_render_docx(
    title: String,
    model: Value,
    template_id: Option<String>,
    output_name: Option<String>,
) -> Result<String, String> {
    let (id, dir) = new_artifact_dir(&title)?;
    let source_path = dir.join("source").join("document.json");
    write_json(&source_path, &model)?;
    let output_path = dir.join("output").join(make_output_name(&title, output_name, "docx"));
    docx::write_docx(&output_path, &model)?;
    let preview_path = dir.join("preview").join("thumbnail.png");
    preview::write_thumbnail(&preview_path, &title, "docx")?;
    let verification = verification_for(&output_path, vec![title.clone()], Some("docx".to_string()));
    finish_artifact(id, dir, title, "docx", template_id, source_path, "application/json", output_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", preview_path, verification)
}

#[tauri::command]
pub async fn artifact_render_pptx(
    title: String,
    model: Value,
    template_id: Option<String>,
    output_name: Option<String>,
) -> Result<String, String> {
    let (id, dir) = new_artifact_dir(&title)?;
    let source_path = dir.join("source").join("deck.json");
    write_json(&source_path, &model)?;
    let output_path = dir.join("output").join(make_output_name(&title, output_name, "pptx"));
    pptx::write_pptx(&output_path, &model)?;
    let preview_path = dir.join("preview").join("thumbnail.png");
    preview::write_thumbnail(&preview_path, &title, "pptx")?;
    let verification = verification_for(&output_path, vec![title.clone()], Some("pptx".to_string()));
    finish_artifact(id, dir, title, "pptx", template_id, source_path, "application/json", output_path, "application/vnd.openxmlformats-officedocument.presentationml.presentation", preview_path, verification)
}

#[tauri::command]
pub async fn artifact_verify(path: String, expected_text: Vec<String>, expected_kind: Option<String>) -> Result<String, String> {
    let p = PathBuf::from(expand_tilde(&path));
    serde_json::to_string_pretty(&verification_for(&p, expected_text, expected_kind)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn artifact_design_lint(path: String, kind: Option<String>, model: Option<Value>) -> Result<String, String> {
    let p = PathBuf::from(expand_tilde(&path));
    if !p.exists() {
        return Err(format!("design_lint_path_missing:{}", p.display()));
    }
    let kind = kind.unwrap_or_else(|| p.extension().and_then(|e| e.to_str()).unwrap_or("pdf").to_string());
    let model = model.unwrap_or(Value::Null);
    serde_json::to_string_pretty(&design_lint_report(&p, &kind, &model)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn artifact_preview(path: String, pages: Option<Vec<u32>>) -> Result<String, String> {
    let _ = pages;
    let p = PathBuf::from(expand_tilde(&path));
    let title = p.file_stem().and_then(|s| s.to_str()).unwrap_or("Artifact");
    let out = p.parent().unwrap_or(Path::new(".")).join("thumbnail.png");
    preview::write_thumbnail(&out, title, p.extension().and_then(|e| e.to_str()).unwrap_or(""))?;
    serde_json::to_string(&vec![out.to_string_lossy().to_string()]).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn artifact_list(workspace_id: Option<String>, task_id: Option<String>) -> Result<String, String> {
    let root = storage::artifact_root()?;
    let start = root
        .join(workspace_id.unwrap_or_else(|| "local".to_string()))
        .join(task_id.unwrap_or_default());
    let base = if start.exists() { start } else { root };
    let mut manifests = Vec::<Value>::new();
    collect_manifests(&base, &mut manifests);
    serde_json::to_string_pretty(&manifests).map_err(|e| e.to_string())
}

fn collect_manifests(dir: &Path, out: &mut Vec<Value>) {
    if out.len() >= 500 {
        return;
    }
    let manifest_path = dir.join("artifact.json");
    if let Ok(text) = std::fs::read_to_string(&manifest_path) {
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            out.push(value);
        }
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            collect_manifests(&entry.path(), out);
        }
    }
}

#[tauri::command]
pub async fn artifact_copy_to(artifact_id: Option<String>, from_path: Option<String>, target_dir: String) -> Result<String, String> {
    let source = if let Some(path) = from_path {
        PathBuf::from(expand_tilde(&path))
    } else {
        find_artifact_output(&artifact_id.ok_or_else(|| "artifact_id_or_from_path_required".to_string())?)?
    };
    let target_dir = PathBuf::from(expand_tilde(&target_dir));
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("copy_target_mkdir_failed: {e}"))?;
    let file_name = source.file_name().ok_or_else(|| "source_file_name_missing".to_string())?;
    let target = target_dir.join(file_name);
    if target.exists() {
        return Err(format!("blocked: target_exists:{}", target.display()));
    }
    std::fs::copy(&source, &target).map_err(|e| format!("artifact_copy_failed: {e}"))?;
    Ok(format!("Copied {} -> {}", source.display(), target.display()))
}

fn find_artifact_output(id: &str) -> Result<PathBuf, String> {
    let mut values = Vec::<Value>::new();
    collect_manifests(&storage::artifact_root()?, &mut values);
    for value in values {
        if value.get("id").and_then(Value::as_str) == Some(id) {
            if let Some(path) = value.get("outputFiles").and_then(Value::as_array).and_then(|a| a.first()).and_then(|f| f.get("path")).and_then(Value::as_str) {
                return Ok(PathBuf::from(path));
            }
        }
    }
    Err(format!("artifact_not_found:{id}"))
}

fn manifest_by_id(id: &str) -> Result<Value, String> {
    let mut values = Vec::<Value>::new();
    collect_manifests(&storage::artifact_root()?, &mut values);
    values
        .into_iter()
        .find(|value| value.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| format!("artifact_not_found:{id}"))
}

fn assert_inside_artifact_store(path: &Path) -> Result<PathBuf, String> {
    let root = storage::artifact_root()?;
    let canonical_root = root.canonicalize().map_err(|e| format!("artifact_root_missing: {e}"))?;
    let canonical_path = path.canonicalize().map_err(|e| format!("artifact_path_missing:{}: {e}", path.display()))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("blocked: path_outside_artifact_store".to_string());
    }
    Ok(canonical_path)
}

fn manifest_file_path(manifest: &Value, file_id: Option<String>, role: &str) -> Result<PathBuf, String> {
    let key = if role == "preview" { "previewFiles" } else { "outputFiles" };
    let files = manifest.get(key).and_then(Value::as_array).ok_or_else(|| format!("manifest_missing_{key}"))?;
    let file = if let Some(file_id) = file_id {
        files
            .iter()
            .find(|file| file.get("id").and_then(Value::as_str) == Some(file_id.as_str()))
            .ok_or_else(|| format!("artifact_file_not_found:{file_id}"))?
    } else {
        files.first().ok_or_else(|| format!("artifact_no_{role}_files"))?
    };
    let path = file.get("path").and_then(Value::as_str).ok_or_else(|| "artifact_file_path_missing".to_string())?;
    assert_inside_artifact_store(&PathBuf::from(path))
}

#[tauri::command]
pub async fn artifact_open(path: Option<String>, artifact_id: Option<String>) -> Result<String, String> {
    let p = if let Some(id) = artifact_id {
        let manifest = manifest_by_id(&id)?;
        manifest_file_path(&manifest, None, "output")?
    } else {
        assert_inside_artifact_store(&PathBuf::from(expand_tilde(&path.ok_or_else(|| "path_or_artifact_id_required".to_string())?)))?
    };
    if !p.exists() {
        return Err(format!("open_path_missing:{}", p.display()));
    }
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", &p.to_string_lossy()]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&p);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&p);
        c
    };
    cmd.spawn().map_err(|e| format!("artifact_open_failed: {e}"))?;
    Ok(format!("Opened {}", p.display()))
}

#[tauri::command]
pub async fn artifact_show_in_folder(artifact_id: String) -> Result<String, String> {
    let manifest = manifest_by_id(&artifact_id)?;
    let p = manifest_file_path(&manifest, None, "output")?;
    if !p.exists() {
        return Err(format!("show_path_missing:{}", p.display()));
    }
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{}", p.to_string_lossy()));
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&p);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(p.parent().ok_or_else(|| "artifact_parent_missing".to_string())?);
        c
    };
    cmd.spawn().map_err(|e| format!("artifact_show_in_folder_failed: {e}"))?;
    Ok(format!("Shown in folder {}", p.display()))
}

#[tauri::command]
pub async fn artifact_save_copy(artifact_id: String, target_path: String) -> Result<String, String> {
    let manifest = manifest_by_id(&artifact_id)?;
    let source = manifest_file_path(&manifest, None, "output")?;
    let target = PathBuf::from(expand_tilde(&target_path));
    if target.exists() {
        return Err(format!("blocked: target_exists:{}", target.display()));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("save_copy_mkdir_failed: {e}"))?;
    }
    std::fs::copy(&source, &target).map_err(|e| format!("artifact_save_copy_failed: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn artifact_get_file_bytes(artifact_id: String, file_id: Option<String>) -> Result<Vec<u8>, String> {
    let manifest = manifest_by_id(&artifact_id)?;
    let path = manifest_file_path(&manifest, file_id, "output")?;
    std::fs::read(&path).map_err(|e| format!("artifact_file_read_failed:{}: {e}", path.display()))
}

#[tauri::command]
pub async fn artifact_get_preview_bytes(artifact_id: String) -> Result<Vec<u8>, String> {
    let manifest = manifest_by_id(&artifact_id)?;
    let path = manifest_file_path(&manifest, None, "preview")?;
    std::fs::read(&path).map_err(|e| format!("artifact_preview_read_failed:{}: {e}", path.display()))
}

#[tauri::command]
pub async fn artifact_get_manifest(artifact_id: String) -> Result<String, String> {
    serde_json::to_string_pretty(&manifest_by_id(&artifact_id)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn artifact_get_source_model(artifact_id: String) -> Result<String, String> {
    let manifest = manifest_by_id(&artifact_id)?;
    let files = manifest.get("sourceFiles").and_then(Value::as_array).ok_or_else(|| "manifest_missing_sourceFiles".to_string())?;
    let first = files.first().ok_or_else(|| "artifact_no_source_files".to_string())?;
    let path = first.get("path").and_then(Value::as_str).ok_or_else(|| "artifact_source_path_missing".to_string())?;
    let p = assert_inside_artifact_store(&PathBuf::from(path))?;
    std::fs::read_to_string(&p).map_err(|e| format!("artifact_source_read_failed:{}: {e}", p.display()))
}

#[tauri::command]
pub async fn artifact_get_text(artifact_id: String) -> Result<String, String> {
    let manifest = manifest_by_id(&artifact_id)?;
    let path = manifest_file_path(&manifest, None, "output")?;
    extract_text(&path)
}

#[tauri::command]
pub async fn artifact_convert(from_path: String, to: String, output_name: Option<String>) -> Result<String, String> {
    let from = PathBuf::from(expand_tilde(&from_path));
    if !from.exists() {
        return Err(format!("convert_source_missing:{}", from.display()));
    }
    let title = output_name.clone().unwrap_or_else(|| from.file_stem().and_then(|s| s.to_str()).unwrap_or("converted").to_string());
    let (id, dir) = new_artifact_dir(&title)?;
    let converted = libreoffice::convert(&from, &to, &dir.join("output"))?;
    let preview_path = dir.join("preview").join("thumbnail.png");
    preview::write_thumbnail(&preview_path, &title, &to)?;
    let verification = verification_for(&converted, vec![], Some(to.clone()));
    let source = file_entry(&from, from.file_name().and_then(|s| s.to_str()).unwrap_or("source"), "application/octet-stream", "source");
    let manifest_value = manifest(&id, &title, &to, None, vec![source], vec![file_entry(&converted, converted.file_name().and_then(|s| s.to_str()).unwrap_or("output"), "application/octet-stream", "output")], vec![file_entry(&preview_path, "thumbnail.png", "image/png", "preview")], verification);
    save_manifest(&dir, &manifest_value)?;
    serde_json::to_string_pretty(&manifest_value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn artifact_pdf_extract_text(path: String) -> Result<String, String> {
    pdf::extract_pdf_text(&PathBuf::from(expand_tilde(&path)))
}

#[tauri::command]
pub async fn artifact_pdf_metadata(path: String) -> Result<String, String> {
    serde_json::to_string_pretty(&pdf::metadata(&PathBuf::from(expand_tilde(&path)))).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn artifact_pdf_page_count(path: String) -> Result<usize, String> {
    Ok(pdf::page_count(&PathBuf::from(expand_tilde(&path))))
}

#[tauri::command]
pub async fn artifact_pdf_merge(paths: Vec<String>, output_path: String) -> Result<String, String> {
    if paths.len() == 1 {
        let src = PathBuf::from(expand_tilde(&paths[0]));
        let dst = PathBuf::from(expand_tilde(&output_path));
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("pdf_merge_mkdir_failed: {e}"))?;
        }
        std::fs::copy(&src, &dst).map_err(|e| format!("pdf_merge_copy_failed: {e}"))?;
        return Ok(format!("Copied single PDF {} -> {}", src.display(), dst.display()));
    }
    Err("blocked: multi_pdf_merge_needs_dedicated_pdf_writer".to_string())
}

#[tauri::command]
pub async fn artifact_pdf_split(path: String, output_dir: String, pages: Option<Vec<u32>>) -> Result<String, String> {
    let _ = (path, output_dir, pages);
    Err("blocked: pdf_split_not_available_in_current_backend".to_string())
}

#[tauri::command]
pub async fn artifact_pdf_watermark(path: String, output_path: String, text: String) -> Result<String, String> {
    let _ = text;
    let src = PathBuf::from(expand_tilde(&path));
    let dst = PathBuf::from(expand_tilde(&output_path));
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("pdf_watermark_mkdir_failed: {e}"))?;
    }
    std::fs::copy(&src, &dst).map_err(|e| format!("pdf_watermark_copy_failed: {e}"))?;
    Ok(format!("Created watermark placeholder copy {} -> {}", src.display(), dst.display()))
}
