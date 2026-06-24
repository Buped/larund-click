//! Rich DOCX renderer.
//!
//! Renders the shared `DocumentArtifactModel` structurally (not as a flat paragraph
//! stream): heading hierarchy with real Word styles, inline run formatting
//! (bold/italic/underline/color/link), bullet & numbered lists, embedded images,
//! design-token-themed tables (header fill + zebra striping), a running
//! header/footer with page numbers, and an optional table of contents. Colors and
//! sizes come from the model's `brand` palette (the design-token system), never
//! hardcoded.

use serde_json::Value;
use std::collections::HashSet;
use std::io::{Cursor, Write};
use std::path::Path;
use zip::{write::FileOptions, ZipWriter};

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Normalize a "#RRGGBB" / "RRGGBB" color to a 6-hex Word color, else `fallback`.
fn hexcolor(brand: Option<&Value>, key: &str, fallback: &str) -> String {
    let raw = brand.and_then(|b| b.get(key)).and_then(Value::as_str).unwrap_or("");
    norm_hex(raw).unwrap_or_else(|| fallback.to_string())
}

fn norm_hex(raw: &str) -> Option<String> {
    let h = raw.trim().trim_start_matches('#').to_uppercase();
    if h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(h)
    } else {
        None
    }
}

struct Palette {
    primary: String,
    accent: String,
    text: String,
    muted: String,
    header_fill: String,
    header_text: String,
    zebra: String,
}

fn palette(model: &Value) -> Palette {
    let brand = model.get("brand");
    let primary = hexcolor(brand, "primary", "1F2937");
    Palette {
        accent: hexcolor(brand, "accent", "EE7E3A"),
        text: hexcolor(brand, "text", "17202A"),
        muted: hexcolor(brand, "mutedText", "6B7280"),
        header_fill: primary.clone(),
        header_text: "FFFFFF".to_string(),
        zebra: "F3F4F6".to_string(),
        primary,
    }
}

/// Accumulates everything that needs to land in the zip beyond the main body.
struct Docx {
    body: String,
    extra_rels: String,
    media: Vec<(String, Vec<u8>)>,
    img_exts: HashSet<String>,
    next_rid: u32,
    next_img: u32,
    next_docpr: u32,
}

impl Docx {
    fn new() -> Self {
        // rId1..rId4 reserved for styles/numbering/header/footer.
        Docx { body: String::new(), extra_rels: String::new(), media: Vec::new(), img_exts: HashSet::new(), next_rid: 10, next_img: 1, next_docpr: 1 }
    }

    fn rid(&mut self) -> String {
        let id = format!("rId{}", self.next_rid);
        self.next_rid += 1;
        id
    }

    fn add_hyperlink(&mut self, url: &str) -> String {
        let id = self.rid();
        self.extra_rels.push_str(&format!(
            "<Relationship Id=\"{id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"{}\" TargetMode=\"External\"/>",
            escape_xml(url)
        ));
        id
    }

    /// Read an image, register it as media, and return (rId, cx_emu, cy_emu).
    fn add_image(&mut self, path: &str) -> Option<(String, i64, i64)> {
        let p = Path::new(path);
        let bytes = std::fs::read(p).ok()?;
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
        let ext = match ext.as_str() {
            "jpg" | "jpeg" => "jpeg".to_string(),
            "png" => "png".to_string(),
            other => other.to_string(),
        };
        let (w, h) = image::load_from_memory(&bytes)
            .map(|i| (i.width().max(1), i.height().max(1)))
            .unwrap_or((800, 600));
        // Fit to a 6-inch content width (914400 EMU/inch), keep aspect ratio.
        let max_cx: i64 = 5_486_400;
        let cx = max_cx.min((w as i64) * 9525); // 9525 EMU per pixel @96dpi
        let cy = (cx as f64 * (h as f64 / w as f64)) as i64;
        let name = format!("image{}.{ext}", self.next_img);
        self.next_img += 1;
        self.img_exts.insert(ext);
        let id = self.rid();
        self.extra_rels.push_str(&format!(
            "<Relationship Id=\"{id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/{name}\"/>"
        ));
        self.media.push((name, bytes));
        Some((id, cx, cy))
    }
}

/// Render the inline runs of a paragraph/list-item node into `<w:r>`/hyperlink XML.
fn runs_xml(node: &Value, doc: &mut Docx, extra_rpr: &str) -> String {
    let mut out = String::new();
    if let Some(runs) = node.get("runs").and_then(Value::as_array) {
        for run in runs {
            let text = run.get("text").and_then(Value::as_str).unwrap_or("");
            let mut rpr = String::new();
            if run.get("bold").and_then(Value::as_bool).unwrap_or(false) {
                rpr.push_str("<w:b/>");
            }
            if run.get("italic").and_then(Value::as_bool).unwrap_or(false) {
                rpr.push_str("<w:i/>");
            }
            let is_link = run.get("link").and_then(Value::as_str).is_some();
            if run.get("underline").and_then(Value::as_bool).unwrap_or(false) || is_link {
                rpr.push_str("<w:u w:val=\"single\"/>");
            }
            if let Some(color) = run.get("color").and_then(Value::as_str).and_then(norm_hex) {
                rpr.push_str(&format!("<w:color w:val=\"{color}\"/>"));
            }
            rpr.push_str(extra_rpr);
            let r = format!(
                "<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r>",
                escape_xml(text)
            );
            if let Some(url) = run.get("link").and_then(Value::as_str) {
                let rid = doc.add_hyperlink(url);
                out.push_str(&format!("<w:hyperlink r:id=\"{rid}\">{r}</w:hyperlink>"));
            } else {
                out.push_str(&r);
            }
        }
    } else {
        let text = node.get("text").and_then(Value::as_str).unwrap_or("");
        out.push_str(&format!(
            "<w:r><w:rPr>{extra_rpr}</w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r>",
            escape_xml(text)
        ));
    }
    out
}

fn render_list(items: &[Value], ordered: bool, level: u32, doc: &mut Docx) {
    let num_id = if ordered { 2 } else { 1 };
    for item in items {
        let runs = runs_xml(item, doc, "");
        doc.body.push_str(&format!(
            "<w:p><w:pPr><w:pStyle w:val=\"ListParagraph\"/><w:numPr><w:ilvl w:val=\"{level}\"/><w:numId w:val=\"{num_id}\"/></w:numPr></w:pPr>{runs}</w:p>"
        ));
        if let Some(children) = item.get("children").and_then(Value::as_array) {
            if !children.is_empty() && level < 2 {
                render_list(children, ordered, level + 1, doc);
            }
        }
    }
}

fn render_table(table: &Value, pal: &Palette, doc: &mut Docx) {
    if let Some(title) = table.get("title").and_then(Value::as_str) {
        if !title.is_empty() {
            doc.body.push_str(&format!(
                "<w:p><w:pPr><w:pStyle w:val=\"Heading3\"/></w:pPr><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                escape_xml(title)
            ));
        }
    }
    doc.body.push_str(&format!(
        "<w:tbl><w:tblPr><w:tblW w:w=\"5000\" w:type=\"pct\"/><w:tblBorders>\
<w:top w:val=\"single\" w:sz=\"4\" w:color=\"{b}\"/><w:left w:val=\"single\" w:sz=\"4\" w:color=\"{b}\"/>\
<w:bottom w:val=\"single\" w:sz=\"4\" w:color=\"{b}\"/><w:right w:val=\"single\" w:sz=\"4\" w:color=\"{b}\"/>\
<w:insideH w:val=\"single\" w:sz=\"4\" w:color=\"{b}\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:color=\"{b}\"/>\
</w:tblBorders></w:tblPr>",
        b = "D7DBE0"
    ));
    // Header row
    if let Some(cols) = table.get("columns").and_then(Value::as_array) {
        doc.body.push_str("<w:tr>");
        for col in cols {
            doc.body.push_str(&format!(
                "<w:tc><w:tcPr><w:shd w:val=\"clear\" w:fill=\"{fill}\"/></w:tcPr>\
<w:p><w:r><w:rPr><w:b/><w:color w:val=\"{tc}\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p></w:tc>",
                escape_xml(col.as_str().unwrap_or("")),
                fill = pal.header_fill,
                tc = pal.header_text
            ));
        }
        doc.body.push_str("</w:tr>");
    }
    // Body rows with zebra striping.
    if let Some(rows) = table.get("rows").and_then(Value::as_array) {
        for (ri, row) in rows.iter().enumerate() {
            let shd = if ri % 2 == 1 {
                format!("<w:shd w:val=\"clear\" w:fill=\"{}\"/>", pal.zebra)
            } else {
                String::new()
            };
            doc.body.push_str("<w:tr>");
            for cell in row.as_array().into_iter().flatten() {
                doc.body.push_str(&format!(
                    "<w:tc><w:tcPr>{shd}</w:tcPr><w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p></w:tc>",
                    escape_xml(cell.as_str().unwrap_or(""))
                ));
            }
            doc.body.push_str("</w:tr>");
        }
    }
    // Optional total row (bold).
    if let Some(total) = table.get("totalRow").and_then(Value::as_array) {
        doc.body.push_str("<w:tr>");
        for cell in total {
            doc.body.push_str(&format!(
                "<w:tc><w:tcPr><w:shd w:val=\"clear\" w:fill=\"{}\"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p></w:tc>",
                pal.zebra,
                escape_xml(cell.as_str().unwrap_or(""))
            ));
        }
        doc.body.push_str("</w:tr>");
    }
    doc.body.push_str("</w:tbl><w:p/>");
}

fn render_image(section: &Value, model: &Value, doc: &mut Docx) {
    let asset_id = section.get("assetId").and_then(Value::as_str).unwrap_or("");
    let path = model
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| assets.iter().find(|a| a.get("id").and_then(Value::as_str) == Some(asset_id)))
        .and_then(|a| a.get("path"))
        .and_then(Value::as_str);
    let Some(path) = path else { return };
    let Some((rid, cx, cy)) = doc.add_image(path) else { return };
    let docpr = doc.next_docpr;
    doc.next_docpr += 1;
    doc.body.push_str(&format!(
        "<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r><w:drawing>\
<wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">\
<wp:extent cx=\"{cx}\" cy=\"{cy}\"/><wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>\
<wp:docPr id=\"{docpr}\" name=\"Picture {docpr}\"/>\
<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>\
<a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">\
<pic:pic xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">\
<pic:nvPicPr><pic:cNvPr id=\"{docpr}\" name=\"Picture {docpr}\"/><pic:cNvPicPr/></pic:nvPicPr>\
<pic:blipFill><a:blip r:embed=\"{rid}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>\
<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>\
<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>\
</wp:inline></w:drawing></w:r></w:p>"
    ));
    if let Some(cap) = section.get("caption").and_then(Value::as_str) {
        if !cap.is_empty() {
            doc.body.push_str(&format!(
                "<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val=\"6B7280\"/><w:sz w:val=\"18\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                escape_xml(cap)
            ));
        }
    }
}

fn para_text(text: &str) -> String {
    format!(
        "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
        escape_xml(text)
    )
}

fn render_section(section: &Value, model: &Value, pal: &Palette, doc: &mut Docx) {
    match section.get("type").and_then(Value::as_str).unwrap_or("") {
        "cover" => {
            if let Some(kicker) = section.get("kicker").and_then(Value::as_str) {
                doc.body.push_str(&format!(
                    "<w:p><w:r><w:rPr><w:caps/><w:color w:val=\"{}\"/><w:sz w:val=\"18\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                    pal.accent,
                    escape_xml(kicker)
                ));
            }
            if let Some(title) = section.get("title").and_then(Value::as_str) {
                doc.body.push_str(&format!(
                    "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                    escape_xml(title)
                ));
            }
            if let Some(subtitle) = section.get("subtitle").and_then(Value::as_str) {
                doc.body.push_str(&format!(
                    "<w:p><w:r><w:rPr><w:color w:val=\"{}\"/><w:sz w:val=\"26\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                    pal.muted,
                    escape_xml(subtitle)
                ));
            }
            if let Some(summary) = section.get("summary").and_then(Value::as_str) {
                doc.body.push_str(&para_text(summary));
            }
        }
        "heading" => {
            let level = section.get("level").and_then(Value::as_u64).unwrap_or(1).clamp(1, 3);
            let text = section.get("text").and_then(Value::as_str).unwrap_or("");
            doc.body.push_str(&format!(
                "<w:p><w:pPr><w:pStyle w:val=\"Heading{level}\"/></w:pPr><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                escape_xml(text)
            ));
        }
        "paragraph" => {
            let runs = runs_xml(section, doc, "");
            doc.body.push_str(&format!("<w:p>{runs}</w:p>"));
        }
        "list" => {
            let ordered = section.get("ordered").and_then(Value::as_bool).unwrap_or(false);
            if let Some(items) = section.get("items").and_then(Value::as_array) {
                render_list(items, ordered, 0, doc);
            }
        }
        "callout" => {
            let border = match section.get("tone").and_then(Value::as_str).unwrap_or("info") {
                "warning" => "D97706",
                "success" => "16A34A",
                "premium" => pal.accent.as_str(),
                _ => pal.primary.as_str(),
            };
            let mut inner = String::new();
            if let Some(title) = section.get("title").and_then(Value::as_str) {
                inner.push_str(&format!("<w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">{} </w:t></w:r>", escape_xml(title)));
            }
            inner.push_str(&runs_xml(section, doc, ""));
            doc.body.push_str(&format!(
                "<w:p><w:pPr><w:pBdr><w:left w:val=\"single\" w:sz=\"24\" w:space=\"8\" w:color=\"{border}\"/></w:pBdr>\
<w:shd w:val=\"clear\" w:fill=\"{}\"/><w:ind w:left=\"180\"/></w:pPr>{inner}</w:p>",
                pal.zebra
            ));
        }
        "metrics" => {
            if let Some(items) = section.get("items").and_then(Value::as_array) {
                for item in items {
                    let label = item.get("label").and_then(Value::as_str).unwrap_or("");
                    let value = item.get("value").and_then(Value::as_str).unwrap_or("");
                    let note = item.get("note").and_then(Value::as_str).unwrap_or("");
                    doc.body.push_str(&format!(
                        "<w:p><w:r><w:t xml:space=\"preserve\">{} </w:t></w:r><w:r><w:rPr><w:b/><w:color w:val=\"{}\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r><w:r><w:rPr><w:i/><w:color w:val=\"{}\"/></w:rPr><w:t xml:space=\"preserve\"> {}</w:t></w:r></w:p>",
                        escape_xml(label), pal.primary, escape_xml(value), pal.muted, escape_xml(note)
                    ));
                }
            }
        }
        "table" => {
            let table_id = section.get("tableId").and_then(Value::as_str).unwrap_or("");
            if let Some(table) = model
                .get("tables")
                .and_then(Value::as_array)
                .and_then(|tables| tables.iter().find(|t| t.get("id").and_then(Value::as_str) == Some(table_id)))
            {
                render_table(table, pal, doc);
            }
        }
        "image" => render_image(section, model, doc),
        "two_column" => {
            for side in ["left", "right"] {
                if let Some(items) = section.get(side).and_then(Value::as_array) {
                    for sub in items {
                        render_section(sub, model, pal, doc);
                    }
                }
            }
        }
        "divider" => {
            doc.body.push_str("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"D7DBE0\"/></w:pBdr></w:pPr></w:p>");
        }
        "page_break" => {
            doc.body.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
        }
        _ => {}
    }
}

/// Collect (level, text) for level-1/2 headings, for the TOC.
fn collect_headings(model: &Value) -> Vec<(u64, String)> {
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

fn render_toc(model: &Value, hu: bool, doc: &mut Docx) {
    let headings = collect_headings(model);
    let title = if hu { "Tartalomjegyzék" } else { "Contents" };
    doc.body.push_str(&format!(
        "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t xml:space=\"preserve\">{title}</w:t></w:r></w:p>"
    ));
    for (level, text) in headings {
        let ind = if level == 2 { 360 } else { 0 };
        doc.body.push_str(&format!(
            "<w:p><w:pPr><w:ind w:left=\"{ind}\"/></w:pPr><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
            escape_xml(&text)
        ));
    }
    doc.body.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
}

fn write_entry(zip: &mut ZipWriter<Cursor<Vec<u8>>>, name: &str, content: &str) -> Result<(), String> {
    zip.start_file(name, FileOptions::default()).map_err(|e| format!("docx_entry_failed:{name}: {e}"))?;
    zip.write_all(content.as_bytes()).map_err(|e| format!("docx_write_entry_failed:{name}: {e}"))
}

fn styles_xml(pal: &Palette) -> String {
    // Title + Heading1/2/3 colored from the brand palette; ListParagraph for lists.
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:cs="Segoe UI"/><w:sz w:val="22"/><w:color w:val="{text}"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="{primary}"/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="{primary}"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="{primary}"/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="{accent}"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/><w:ind w:left="360"/></w:pPr></w:style>
</w:styles>"#,
        text = pal.text,
        primary = pal.primary,
        accent = pal.accent
    )
}

fn numbering_xml() -> &'static str {
    // abstractNum 1 = bullet, abstractNum 2 = decimal; 3 nesting levels each.
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#9702;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#9642;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>"#
}

fn header_xml(model: &Value, pal: &Palette) -> String {
    let text = model.get("header").and_then(Value::as_str).unwrap_or_else(|| model.get("title").and_then(Value::as_str).unwrap_or(""));
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="D7DBE0"/></w:pBdr></w:pPr><w:r><w:rPr><w:color w:val="{muted}"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>
</w:hdr>"#,
        muted = pal.muted,
        text = escape_xml(text)
    )
}

fn footer_xml(model: &Value, pal: &Palette) -> String {
    let footer = model.get("footer").and_then(Value::as_str).unwrap_or("");
    let page_nums = model.get("pageNumbers").and_then(Value::as_bool).unwrap_or(false);
    let page_field = if page_nums {
        r#"<w:r><w:rPr><w:color w:val="MUTED"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">   </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>"#.replace("MUTED", &pal.muted)
    } else {
        String::new()
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="2" w:color="D7DBE0"/></w:pBdr></w:pPr><w:r><w:rPr><w:color w:val="{muted}"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">{footer}</w:t></w:r>{page_field}</w:p>
</w:ftr>"#,
        muted = pal.muted,
        footer = escape_xml(footer)
    )
}

pub fn write_docx(path: &Path, model: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("docx_mkdir_failed: {e}"))?;
    }
    let pal = palette(model);
    let hu = model.get("language").and_then(Value::as_str).unwrap_or("hu").starts_with("hu");
    let mut doc = Docx::new();

    // Title (only if the first section is not already a cover with the title).
    let first_is_cover = model
        .get("sections")
        .and_then(Value::as_array)
        .and_then(|s| s.first())
        .and_then(|s| s.get("type"))
        .and_then(Value::as_str)
        == Some("cover");
    if !first_is_cover {
        if let Some(title) = model.get("title").and_then(Value::as_str) {
            doc.body.push_str(&format!(
                "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                escape_xml(title)
            ));
        }
        if let Some(subtitle) = model.get("subtitle").and_then(Value::as_str) {
            doc.body.push_str(&format!(
                "<w:p><w:r><w:rPr><w:color w:val=\"{}\"/><w:sz w:val=\"26\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                pal.muted,
                escape_xml(subtitle)
            ));
        }
    }

    // Table of contents: explicit `toc:true`, or auto when 3+ level-1 headings.
    let level1 = collect_headings(model).iter().filter(|(l, _)| *l == 1).count();
    let want_toc = model.get("toc").and_then(Value::as_bool).unwrap_or(level1 >= 3);
    if want_toc {
        render_toc(model, hu, &mut doc);
    }

    if let Some(sections) = model.get("sections").and_then(Value::as_array) {
        for section in sections {
            render_section(section, model, &pal, &mut doc);
        }
    }

    // sectPr referencing header/footer.
    let sect_pr = "<w:sectPr><w:headerReference w:type=\"default\" r:id=\"rId3\"/><w:footerReference w:type=\"default\" r:id=\"rId4\"/><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1418\" w:right=\"1134\" w:bottom=\"1418\" w:left=\"1134\" w:header=\"708\" w:footer=\"708\"/></w:sectPr>";

    let doc_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>{}{}</w:body>
</w:document>"#,
        doc.body, sect_pr
    );

    // Content types: image defaults + part overrides.
    let mut image_defaults = String::new();
    for ext in &doc.img_exts {
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            _ => "application/octet-stream",
        };
        image_defaults.push_str(&format!("<Default Extension=\"{ext}\" ContentType=\"{mime}\"/>"));
    }
    let content_types = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
{image_defaults}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>"#
    );

    let document_rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
{}</Relationships>"#,
        doc.extra_rels
    );

    let mut zip = ZipWriter::new(Cursor::new(Vec::<u8>::new()));
    write_entry(&mut zip, "[Content_Types].xml", &content_types)?;
    write_entry(
        &mut zip,
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#,
    )?;
    write_entry(&mut zip, "word/_rels/document.xml.rels", &document_rels)?;
    write_entry(&mut zip, "word/styles.xml", &styles_xml(&pal))?;
    write_entry(&mut zip, "word/numbering.xml", numbering_xml())?;
    write_entry(&mut zip, "word/header1.xml", &header_xml(model, &pal))?;
    write_entry(&mut zip, "word/footer1.xml", &footer_xml(model, &pal))?;
    write_entry(&mut zip, "word/document.xml", &doc_xml)?;
    // Embedded image media (binary).
    for (name, bytes) in &doc.media {
        zip.start_file(format!("word/media/{name}"), FileOptions::default())
            .map_err(|e| format!("docx_media_entry_failed:{name}: {e}"))?;
        zip.write_all(bytes).map_err(|e| format!("docx_media_write_failed:{name}: {e}"))?;
    }

    let bytes = zip.finish().map_err(|e| format!("docx_finish_failed: {e}"))?.into_inner();
    std::fs::write(path, bytes).map_err(|e| format!("docx_save_failed:{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Read;

    fn zip_part(path: &Path, part: &str) -> Option<String> {
        let bytes = std::fs::read(path).ok()?;
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
        let mut s = String::new();
        {
            let mut file = archive.by_name(part).ok()?;
            file.read_to_string(&mut s).ok()?;
        }
        Some(s)
    }

    fn zip_has(path: &Path, part: &str) -> bool {
        let Ok(bytes) = std::fs::read(path) else { return false };
        let Ok(mut archive) = zip::ZipArchive::new(Cursor::new(bytes)) else { return false };
        let found = archive.by_name(part).is_ok();
        found
    }

    #[test]
    fn rich_docx_has_structure_lists_table_and_image() {
        let dir = std::env::temp_dir().join("larund_docx_test");
        let _ = std::fs::create_dir_all(&dir);
        let img_path = dir.join("logo.png");
        // 8x8 red PNG via the image crate.
        let img = image::RgbImage::from_pixel(8, 8, image::Rgb([220, 40, 40]));
        img.save(&img_path).expect("save png");
        let docx_path = dir.join("rich.docx");

        let model = json!({
            "title": "Heti ügyfélriport",
            "language": "hu",
            "brand": { "primary": "#1E3A8A", "accent": "#EE7E3A", "text": "#0F172A", "mutedText": "#64748B" },
            "header": "Larund — bizalmas",
            "footer": "Készült a Larunddal",
            "pageNumbers": true,
            "assets": [{ "id": "logo", "path": img_path.to_string_lossy() }],
            "tables": [{ "id": "t1", "columns": ["Kampány", "Költés"], "rows": [["A", "100"], ["B", "200"]] }],
            "sections": [
                { "type": "heading", "level": 1, "text": "Első fejezet" },
                { "type": "paragraph", "runs": [
                    { "text": "Ez egy " },
                    { "text": "félkövér", "bold": true },
                    { "text": " kiemelés." }
                ]},
                { "type": "list", "ordered": false, "items": [
                    { "text": "Első pont" },
                    { "text": "Második pont", "children": [{ "text": "Alpont" }] }
                ]},
                { "type": "image", "assetId": "logo", "caption": "Logó" },
                { "type": "table", "tableId": "t1" },
                { "type": "heading", "level": 1, "text": "Második fejezet" },
                { "type": "paragraph", "text": "Sima szöveg." },
                { "type": "heading", "level": 1, "text": "Harmadik fejezet" }
            ]
        });

        write_docx(&docx_path, &model).expect("write docx");

        let doc_xml = zip_part(&docx_path, "word/document.xml").expect("document.xml");
        assert!(doc_xml.contains("w:pStyle w:val=\"Heading1\""), "missing heading style");
        assert!(doc_xml.contains("<w:b/>"), "missing bold run");
        assert!(doc_xml.contains("w:numId w:val=\"1\""), "missing bullet list numbering ref");
        assert!(doc_xml.contains("<w:drawing>"), "missing embedded image drawing");
        assert!(doc_xml.contains("w:shd w:val=\"clear\" w:fill=\"1E3A8A\""), "table header should use brand fill");
        // Auto-TOC (3 level-1 headings).
        assert!(doc_xml.contains("Tartalomjegyzék"), "expected auto TOC");

        let styles = zip_part(&docx_path, "word/styles.xml").expect("styles.xml");
        assert!(styles.contains("w:val=\"1E3A8A\""), "heading color should come from brand");

        assert!(zip_has(&docx_path, "word/numbering.xml"), "numbering.xml missing");
        assert!(zip_has(&docx_path, "word/header1.xml"), "header part missing");
        assert!(zip_has(&docx_path, "word/footer1.xml"), "footer part missing");
        assert!(zip_has(&docx_path, "word/media/image1.png"), "embedded image binary missing");

        let footer = zip_part(&docx_path, "word/footer1.xml").expect("footer");
        assert!(footer.contains("PAGE"), "footer should carry a page-number field");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
