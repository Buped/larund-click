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

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn brand_color<'a>(model: &'a Value, key: &str, fallback: &'a str) -> String {
    model
        .get("brand")
        .and_then(|b| b.get(key))
        .and_then(Value::as_str)
        .filter(|s| s.starts_with('#') || s.len() == 6)
        .map(|s| s.to_string())
        .unwrap_or_else(|| fallback.to_string())
}

/// Render the inline runs of a node (paragraph / list item) to inline HTML.
fn runs_html(node: &Value) -> String {
    if let Some(runs) = node.get("runs").and_then(Value::as_array) {
        let mut out = String::new();
        for run in runs {
            let text = html_escape(run.get("text").and_then(Value::as_str).unwrap_or(""));
            let mut style = String::new();
            if run.get("bold").and_then(Value::as_bool).unwrap_or(false) {
                style.push_str("font-weight:700;");
            }
            if run.get("italic").and_then(Value::as_bool).unwrap_or(false) {
                style.push_str("font-style:italic;");
            }
            if run.get("underline").and_then(Value::as_bool).unwrap_or(false) {
                style.push_str("text-decoration:underline;");
            }
            if let Some(color) = run.get("color").and_then(Value::as_str) {
                style.push_str(&format!("color:{};", html_escape(color)));
            }
            if let Some(url) = run.get("link").and_then(Value::as_str) {
                out.push_str(&format!("<a href=\"{}\" style=\"{style}\">{text}</a>", html_escape(url)));
            } else {
                out.push_str(&format!("<span style=\"{style}\">{text}</span>"));
            }
        }
        out
    } else {
        html_escape(node.get("text").and_then(Value::as_str).unwrap_or(""))
    }
}

fn list_html(items: &[Value], ordered: bool) -> String {
    let tag = if ordered { "ol" } else { "ul" };
    let mut out = format!("<{tag}>");
    for item in items {
        out.push_str(&format!("<li>{}", runs_html(item)));
        if let Some(children) = item.get("children").and_then(Value::as_array) {
            if !children.is_empty() {
                out.push_str(&list_html(children, ordered));
            }
        }
        out.push_str("</li>");
    }
    out.push_str(&format!("</{tag}>"));
    out
}

fn table_html(table: &Value) -> String {
    let mut out = String::new();
    if let Some(title) = table.get("title").and_then(Value::as_str) {
        if !title.is_empty() {
            out.push_str(&format!("<h3>{}</h3>", html_escape(title)));
        }
    }
    out.push_str("<table><thead><tr>");
    if let Some(cols) = table.get("columns").and_then(Value::as_array) {
        for col in cols {
            out.push_str(&format!("<th>{}</th>", html_escape(col.as_str().unwrap_or(""))));
        }
    }
    out.push_str("</tr></thead><tbody>");
    if let Some(rows) = table.get("rows").and_then(Value::as_array) {
        for row in rows {
            out.push_str("<tr>");
            for cell in row.as_array().into_iter().flatten() {
                out.push_str(&format!("<td>{}</td>", html_escape(cell.as_str().unwrap_or(""))));
            }
            out.push_str("</tr>");
        }
    }
    out.push_str("</tbody>");
    if let Some(total) = table.get("totalRow").and_then(Value::as_array) {
        out.push_str("<tfoot><tr>");
        for cell in total {
            out.push_str(&format!("<td>{}</td>", html_escape(cell.as_str().unwrap_or(""))));
        }
        out.push_str("</tr></tfoot>");
    }
    out.push_str("</table>");
    out
}

fn image_html(section: &Value, model: &Value) -> String {
    let asset_id = section.get("assetId").and_then(Value::as_str).unwrap_or("");
    let path = model
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| assets.iter().find(|a| a.get("id").and_then(Value::as_str) == Some(asset_id)))
        .and_then(|a| a.get("path"))
        .and_then(Value::as_str);
    let Some(path) = path else { return String::new() };
    let Ok(bytes) = std::fs::read(path) else { return String::new() };
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let caption = section
        .get("caption")
        .and_then(Value::as_str)
        .filter(|c| !c.is_empty())
        .map(|c| format!("<figcaption>{}</figcaption>", html_escape(c)))
        .unwrap_or_default();
    format!("<figure><img src=\"data:{mime};base64,{b64}\"/>{caption}</figure>")
}

fn section_html(section: &Value, model: &Value) -> String {
    match section.get("type").and_then(Value::as_str).unwrap_or("") {
        "cover" => {
            let mut out = String::from("<section class=\"cover\">");
            if let Some(k) = section.get("kicker").and_then(Value::as_str) {
                out.push_str(&format!("<div class=\"kicker\">{}</div>", html_escape(k)));
            }
            if let Some(t) = section.get("title").and_then(Value::as_str) {
                out.push_str(&format!("<h1 class=\"cover-title\">{}</h1>", html_escape(t)));
            }
            if let Some(s) = section.get("subtitle").and_then(Value::as_str) {
                out.push_str(&format!("<div class=\"subtitle\">{}</div>", html_escape(s)));
            }
            if let Some(s) = section.get("summary").and_then(Value::as_str) {
                out.push_str(&format!("<p>{}</p>", html_escape(s)));
            }
            out.push_str("</section>");
            out
        }
        "heading" => {
            let level = section.get("level").and_then(Value::as_u64).unwrap_or(1).clamp(1, 3);
            format!("<h{level}>{}</h{level}>", html_escape(section.get("text").and_then(Value::as_str).unwrap_or("")))
        }
        "paragraph" => format!("<p>{}</p>", runs_html(section)),
        "list" => list_html(
            section.get("items").and_then(Value::as_array).map(|v| v.as_slice()).unwrap_or(&[]),
            section.get("ordered").and_then(Value::as_bool).unwrap_or(false),
        ),
        "callout" => {
            let tone = section.get("tone").and_then(Value::as_str).unwrap_or("info");
            let title = section
                .get("title")
                .and_then(Value::as_str)
                .filter(|t| !t.is_empty())
                .map(|t| format!("<strong>{}</strong> ", html_escape(t)))
                .unwrap_or_default();
            format!("<div class=\"callout {tone}\">{title}{}</div>", runs_html(section))
        }
        "metrics" => {
            let mut out = String::from("<div class=\"metrics\">");
            if let Some(items) = section.get("items").and_then(Value::as_array) {
                for item in items {
                    out.push_str(&format!(
                        "<div class=\"metric\"><div class=\"metric-value\">{}</div><div class=\"metric-label\">{}</div><div class=\"metric-note\">{}</div></div>",
                        html_escape(item.get("value").and_then(Value::as_str).unwrap_or("")),
                        html_escape(item.get("label").and_then(Value::as_str).unwrap_or("")),
                        html_escape(item.get("note").and_then(Value::as_str).unwrap_or(""))
                    ));
                }
            }
            out.push_str("</div>");
            out
        }
        "table" => {
            let table_id = section.get("tableId").and_then(Value::as_str).unwrap_or("");
            model
                .get("tables")
                .and_then(Value::as_array)
                .and_then(|tables| tables.iter().find(|t| t.get("id").and_then(Value::as_str) == Some(table_id)))
                .map(table_html)
                .unwrap_or_default()
        }
        "image" => image_html(section, model),
        "two_column" => {
            let mut out = String::from("<div class=\"two-col\"><div>");
            for sub in section.get("left").and_then(Value::as_array).into_iter().flatten() {
                out.push_str(&section_html(sub, model));
            }
            out.push_str("</div><div>");
            for sub in section.get("right").and_then(Value::as_array).into_iter().flatten() {
                out.push_str(&section_html(sub, model));
            }
            out.push_str("</div></div>");
            out
        }
        "divider" => "<hr/>".to_string(),
        "page_break" => "<div class=\"page-break\"></div>".to_string(),
        _ => String::new(),
    }
}

fn collect_headings_html(model: &Value) -> Vec<(u64, String)> {
    let mut out = Vec::new();
    if let Some(sections) = model.get("sections").and_then(Value::as_array) {
        for s in sections {
            if s.get("type").and_then(Value::as_str) == Some("heading") {
                let level = s.get("level").and_then(Value::as_u64).unwrap_or(1);
                if level <= 2 {
                    if let Some(text) = s.get("text").and_then(Value::as_str) {
                        out.push((level, text.to_string()));
                    }
                }
            }
        }
    }
    out
}

pub fn render_html(model: &Value, template_id: Option<&str>) -> String {
    let title = model.get("title").and_then(Value::as_str).unwrap_or("Artifact");
    let hu = model.get("language").and_then(Value::as_str).unwrap_or("hu").starts_with("hu");
    let mut body = String::new();

    let first_is_cover = model
        .get("sections")
        .and_then(Value::as_array)
        .and_then(|s| s.first())
        .and_then(|s| s.get("type"))
        .and_then(Value::as_str)
        == Some("cover");
    if !first_is_cover {
        body.push_str(&format!("<h1 class=\"doc-title\">{}</h1>", html_escape(title)));
        if let Some(sub) = model.get("subtitle").and_then(Value::as_str) {
            body.push_str(&format!("<div class=\"subtitle\">{}</div>", html_escape(sub)));
        }
    }

    let level1 = collect_headings_html(model).iter().filter(|(l, _)| *l == 1).count();
    if model.get("toc").and_then(Value::as_bool).unwrap_or(level1 >= 3) {
        body.push_str(&format!("<div class=\"toc\"><h2>{}</h2><ul>", if hu { "Tartalomjegyzék" } else { "Contents" }));
        for (level, text) in collect_headings_html(model) {
            body.push_str(&format!("<li class=\"lvl{level}\">{}</li>", html_escape(&text)));
        }
        body.push_str("</ul></div><div class=\"page-break\"></div>");
    }

    if let Some(sections) = model.get("sections").and_then(Value::as_array) {
        for section in sections {
            body.push_str(&section_html(section, model));
        }
    }

    let header = model.get("header").and_then(Value::as_str).filter(|h| !h.is_empty());
    let footer = model.get("footer").and_then(Value::as_str).filter(|f| !f.is_empty());
    let header_html = header.map(|h| format!("<header class=\"run-head\">{}</header>", html_escape(h))).unwrap_or_default();
    let footer_html = footer.map(|f| format!("<footer class=\"run-foot\">{}</footer>", html_escape(f))).unwrap_or_default();

    format!(
        r#"<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8"><title>{title_esc}</title><style>{css}</style></head>
<body class="{tpl}"><main>{header_html}{body}{footer_html}</main></body></html>"#,
        lang = if hu { "hu" } else { "en" },
        title_esc = html_escape(title),
        css = themed_css(model),
        tpl = template_id.unwrap_or("modern-light-report"),
    )
}

/// Full design-token-driven CSS: heading hierarchy, lists, images, callouts,
/// themed tables (header fill + zebra), metrics grid, running header/footer.
fn themed_css(model: &Value) -> String {
    let primary = brand_color(model, "primary", "#1F2937");
    let accent = brand_color(model, "accent", "#EE7E3A");
    let text = brand_color(model, "text", "#17202A");
    let muted = brand_color(model, "mutedText", "#6B7280");
    let surface = brand_color(model, "surface", "#FFFFFF");
    let background = brand_color(model, "background", "#F6F7F9");
    format!(
        r#"
:root {{ --primary:{primary}; --accent:{accent}; --text:{text}; --muted:{muted}; --surface:{surface}; --bg:{background}; }}
@page {{ size: A4; margin: 18mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: "Segoe UI", "Noto Sans", Arial, sans-serif; color: var(--text); background: var(--bg); margin: 0; }}
main {{ max-width: 760px; margin: 0 auto; background: var(--surface); padding: 48px; }}
h1, h2, h3 {{ color: var(--primary); line-height: 1.15; }}
h1.doc-title, .cover-title {{ font-size: 34px; font-weight: 800; margin: 0 0 6px; }}
.cover {{ border-bottom: 3px solid var(--accent); padding-bottom: 18px; margin-bottom: 24px; }}
.kicker {{ text-transform: uppercase; letter-spacing: .12em; font-size: 11px; font-weight: 700; color: var(--accent); }}
.subtitle {{ font-size: 15px; color: var(--muted); margin-bottom: 18px; }}
h1 {{ font-size: 26px; margin: 26px 0 10px; }}
h2 {{ font-size: 20px; margin: 22px 0 8px; }}
h3 {{ font-size: 15px; color: var(--accent); margin: 18px 0 6px; }}
p {{ font-size: 13px; line-height: 1.6; margin: 0 0 10px; }}
ul, ol {{ font-size: 13px; line-height: 1.6; padding-left: 22px; margin: 0 0 12px; }}
li {{ margin: 3px 0; }}
a {{ color: var(--accent); }}
hr {{ border: none; border-top: 1px solid #E2E5EA; margin: 18px 0; }}
figure {{ margin: 16px 0; text-align: center; }}
figure img {{ max-width: 100%; border-radius: 8px; }}
figcaption {{ font-size: 11px; color: var(--muted); font-style: italic; margin-top: 6px; }}
.callout {{ border-left: 4px solid var(--primary); background: #F3F4F6; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin: 12px 0; }}
.callout.warning {{ border-left-color: #D97706; }}
.callout.success {{ border-left-color: #16A34A; }}
.callout.premium {{ border-left-color: var(--accent); }}
.two-col {{ display: flex; gap: 24px; }}
.two-col > div {{ flex: 1; }}
.metrics {{ display: flex; gap: 16px; flex-wrap: wrap; margin: 14px 0; }}
.metric {{ flex: 1; min-width: 120px; background: #F3F4F6; border-radius: 10px; padding: 14px; }}
.metric-value {{ font-size: 22px; font-weight: 800; color: var(--primary); }}
.metric-label {{ font-size: 12px; color: var(--text); }}
.metric-note {{ font-size: 10px; color: var(--muted); }}
table {{ width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 12px; }}
th {{ background: var(--primary); color: #fff; text-align: left; padding: 8px 10px; }}
td {{ padding: 7px 10px; border-bottom: 1px solid #E2E5EA; }}
tbody tr:nth-child(even) td {{ background: #F3F4F6; }}
tfoot td {{ font-weight: 700; background: #ECEFF3; }}
.toc {{ background: #F3F4F6; border-radius: 10px; padding: 18px 24px; }}
.toc ul {{ list-style: none; padding-left: 0; }}
.toc li.lvl2 {{ padding-left: 18px; color: var(--muted); }}
.run-head {{ color: var(--muted); font-size: 11px; border-bottom: 1px solid #E2E5EA; padding-bottom: 6px; margin-bottom: 18px; }}
.run-foot {{ color: var(--muted); font-size: 11px; border-top: 1px solid #E2E5EA; padding-top: 6px; margin-top: 24px; text-align: center; }}
.page-break {{ page-break-after: always; }}
"#
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn render_html_is_structured_and_themed() {
        let model = json!({
            "title": "Heti riport",
            "language": "hu",
            "brand": { "primary": "#1E3A8A", "accent": "#EE7E3A" },
            "tables": [{ "id": "t1", "columns": ["A", "B"], "rows": [["1", "2"]] }],
            "sections": [
                { "type": "heading", "level": 1, "text": "Fejezet egy" },
                { "type": "paragraph", "runs": [{ "text": "vastag", "bold": true }, { "text": " normál" }] },
                { "type": "list", "ordered": false, "items": [{ "text": "egy" }, { "text": "kettő" }] },
                { "type": "table", "tableId": "t1" }
            ]
        });
        let html = render_html(&model, Some("modern-light-report"));
        assert!(html.contains("<h1>Fejezet egy</h1>"), "heading missing");
        assert!(html.contains("font-weight:700"), "bold run missing");
        assert!(html.contains("<ul><li>"), "bullet list missing");
        assert!(html.contains("<table>") && html.contains("<th>A</th>"), "themed table missing");
        assert!(html.contains("--primary:#1E3A8A"), "brand color not wired into CSS");
    }
}
