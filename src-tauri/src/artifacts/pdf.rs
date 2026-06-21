use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, Stream};
use serde_json::{json, Value};
use std::path::Path;

fn collect_section_text(section: &Value, out: &mut Vec<String>) {
    match section.get("type").and_then(Value::as_str).unwrap_or("") {
        "cover" => {
            for key in ["kicker", "title", "subtitle", "summary"] {
                if let Some(text) = section.get(key).and_then(Value::as_str) {
                    out.push(text.to_string());
                }
            }
            out.push(String::new());
        }
        "heading" => out.push(section.get("text").and_then(Value::as_str).unwrap_or("").to_string()),
        "paragraph" => out.push(section.get("text").and_then(Value::as_str).unwrap_or("").to_string()),
        "callout" => {
            if let Some(title) = section.get("title").and_then(Value::as_str) {
                out.push(title.to_string());
            }
            out.push(section.get("text").and_then(Value::as_str).unwrap_or("").to_string());
        }
        "metrics" => {
            if let Some(items) = section.get("items").and_then(Value::as_array) {
                for item in items {
                    out.push(format!(
                        "{}: {} {}",
                        item.get("label").and_then(Value::as_str).unwrap_or(""),
                        item.get("value").and_then(Value::as_str).unwrap_or(""),
                        item.get("note").and_then(Value::as_str).unwrap_or("")
                    ));
                }
            }
        }
        "two_column" => {
            for side in ["left", "right"] {
                if let Some(items) = section.get(side).and_then(Value::as_array) {
                    for item in items {
                        collect_section_text(item, out);
                    }
                }
            }
        }
        "page_break" => out.push("\u{000C}".to_string()),
        _ => {}
    }
}

pub fn model_lines(model: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(title) = model.get("title").and_then(Value::as_str) {
        out.push(title.to_string());
    }
    if let Some(subtitle) = model.get("subtitle").and_then(Value::as_str) {
        out.push(subtitle.to_string());
    }
    if let Some(sections) = model.get("sections").and_then(Value::as_array) {
        for section in sections {
            collect_section_text(section, &mut out);
        }
    }
    if let Some(tables) = model.get("tables").and_then(Value::as_array) {
        for table in tables {
            if let Some(title) = table.get("title").and_then(Value::as_str) {
                out.push(title.to_string());
            }
            if let Some(cols) = table.get("columns").and_then(Value::as_array) {
                out.push(cols.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" | "));
            }
            if let Some(rows) = table.get("rows").and_then(Value::as_array) {
                for row in rows {
                    if let Some(cells) = row.as_array() {
                        out.push(cells.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" | "));
                    }
                }
            }
        }
    }
    out.into_iter().flat_map(wrap_line).collect()
}

fn wrap_line(line: String) -> Vec<String> {
    if line == "\u{000C}" || line.len() <= 86 {
        return vec![line];
    }
    let mut out = Vec::new();
    let mut current = String::new();
    for word in line.split_whitespace() {
        if current.len() + word.len() + 1 > 86 && !current.is_empty() {
            out.push(current);
            current = String::new();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

pub fn render_html(model: &Value, template_id: Option<&str>) -> String {
    let title = model.get("title").and_then(Value::as_str).unwrap_or("Artifact");
    let mut body = String::new();
    for line in model_lines(model) {
        if line == "\u{000C}" {
            body.push_str("<div class=\"page-break\"></div>");
        } else if !line.trim().is_empty() {
            body.push_str(&format!("<p>{}</p>\n", html_escape(&line)));
        }
    }
    format!(
        r#"<!doctype html>
<html><head><meta charset="utf-8"><title>{}</title><style>{}</style></head>
<body class="{}"><main>{}</main></body></html>"#,
        html_escape(title),
        default_css(),
        template_id.unwrap_or("modern-light-report"),
        body
    )
}

fn html_escape(input: &str) -> String {
    input.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn default_css() -> &'static str {
    r#"
@page { size: A4; margin: 22mm; }
body { font-family: Segoe UI, Arial, sans-serif; color: #17202a; background: #f6f7f9; }
body.premium-dark-report { color: #f7efe3; background: #111318; }
main { max-width: 760px; margin: 0 auto; background: white; padding: 42px; border-radius: 8px; }
body.premium-dark-report main { background: #171a21; }
p:first-child { font-size: 34px; line-height: 1.05; font-weight: 800; margin-top: 0; }
p { font-size: 13px; line-height: 1.55; }
.page-break { page-break-after: always; }
"#
}

pub fn write_pdf(path: &Path, model: &Value) -> Result<usize, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("pdf_mkdir_failed: {e}"))?;
    }
    let lines = model_lines(model);
    let mut doc = Document::with_version("1.5");
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let resources_id = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });
    let mut page_ids = Vec::new();
    let mut page_lines: Vec<Vec<String>> = vec![Vec::new()];
    for line in lines {
        if line == "\u{000C}" || page_lines.last().map(|p| p.len() >= 38).unwrap_or(false) {
            page_lines.push(Vec::new());
            if line == "\u{000C}" {
                continue;
            }
        }
        if let Some(page) = page_lines.last_mut() {
            page.push(line);
        }
    }
    for page in &page_lines {
        let mut operations = vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec!["F1".into(), 11.into()]),
            Operation::new("Td", vec![54.into(), 790.into()]),
        ];
        for (idx, line) in page.iter().enumerate() {
            if idx == 0 {
                operations.push(Operation::new("Tf", vec!["F1".into(), 22.into()]));
            } else if idx == 1 {
                operations.push(Operation::new("Tf", vec!["F1".into(), 13.into()]));
            } else {
                operations.push(Operation::new("Tf", vec!["F1".into(), 11.into()]));
            }
            operations.push(Operation::new("Tj", vec![Object::string_literal(line.as_str())]));
            operations.push(Operation::new("Td", vec![0.into(), (-18).into()]));
        }
        operations.push(Operation::new("ET", vec![]));
        let mut stream = Stream::new(dictionary! {}, Content { operations }.encode().map_err(|e| e.to_string())?);
        stream.compress().ok();
        let content_id = doc.add_object(stream);
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Contents" => content_id,
            "Resources" => resources_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        page_ids.push(page_id);
    }
    let kids = page_ids.iter().map(|id| Object::Reference(*id)).collect::<Vec<_>>();
    let pages_id = doc.add_object(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => page_ids.len() as i64 });
    for page_id in page_ids.iter() {
        if let Ok(Object::Dictionary(page)) = doc.get_object_mut(*page_id) {
            page.set("Parent", pages_id);
        }
    }
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    doc.compress();
    doc.save(path).map_err(|e| format!("pdf_save_failed:{}: {e}", path.display()))?;
    Ok(page_lines.len().max(1))
}

pub fn extract_pdf_text(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("pdf_read_failed:{}: {e}", path.display()))?;
    pdf_extract::extract_text_from_mem(&bytes)
        .map(|t| t.split_whitespace().collect::<Vec<_>>().join(" "))
        .map_err(|e| format!("pdf_extract_failed: {e}"))
}

pub fn page_count(path: &Path) -> usize {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| lopdf::Document::load_mem(&bytes).ok())
        .map(|doc| doc.get_pages().len())
        .unwrap_or(0)
}

pub fn metadata(path: &Path) -> Value {
    let meta = std::fs::metadata(path).ok();
    json!({
        "path": path.to_string_lossy(),
        "sizeBytes": meta.as_ref().map(|m| m.len()).unwrap_or(0),
        "pageCount": page_count(path),
    })
}
