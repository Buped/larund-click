// Themed PPTX renderer.
//
// Renders a designed deck (not skeleton text boxes): each slide gets a full-bleed
// themed background, an accent system, and a per-layout composition of shapes and
// styled text driven by `model.theme` + each slide's `type`. Text is stored as
// UTF-8 in the OOXML `<a:t>` runs, so Hungarian accents render correctly.

use serde_json::Value;
use std::io::{Cursor, Write};
use std::path::Path;
use zip::{write::FileOptions, ZipWriter};

const W: i64 = 12_192_000; // 13.333in
const H: i64 = 6_858_000; // 7.5in
const M: i64 = 760_000; // side margin
const FONT: &str = "Segoe UI";

fn escape_xml(input: &str) -> String {
    input.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn write_entry(zip: &mut ZipWriter<Cursor<Vec<u8>>>, name: &str, content: &str) -> Result<(), String> {
    zip.start_file(name, FileOptions::default()).map_err(|e| format!("pptx_entry_failed:{name}: {e}"))?;
    zip.write_all(content.as_bytes()).map_err(|e| format!("pptx_write_entry_failed:{name}: {e}"))
}

// ── theme ────────────────────────────────────────────────────────────────────

struct Theme {
    background: String,
    surface: String,
    surface_alt: String,
    primary: String,
    accent: String,
    text: String,
    muted: String,
    border: String,
    on_accent: String,
}

fn hex(value: Option<&str>, fallback: &str) -> String {
    let raw = value.unwrap_or(fallback).trim().trim_start_matches('#');
    let cleaned: String = raw.chars().filter(|c| c.is_ascii_hexdigit()).take(6).collect();
    if cleaned.len() == 6 { cleaned.to_uppercase() } else { fallback.trim_start_matches('#').to_uppercase() }
}

fn read_theme(model: &Value) -> Theme {
    let t = model.get("theme");
    let get = |key: &str, fb: &str| hex(t.and_then(|v| v.get(key)).and_then(Value::as_str), fb);
    Theme {
        background: get("background", "0B0E14"),
        surface: get("surface", "171A21"),
        surface_alt: get("surfaceAlt", "1F242E"),
        primary: get("primary", "EE7E3A"),
        accent: get("accent", "F4A261"),
        text: get("text", "F7EFE3"),
        muted: get("mutedText", "A6AEBD"),
        border: get("border", "2A2F3A"),
        on_accent: get("onAccent", "0B0E14"),
    }
}

// ── shape canvas ─────────────────────────────────────────────────────────────

struct Canvas {
    shapes: String,
    id: i32,
}

impl Canvas {
    fn new() -> Self {
        Self { shapes: String::new(), id: 1 }
    }

    fn next(&mut self) -> i32 {
        self.id += 1;
        self.id
    }

    fn shape(&mut self, x: i64, y: i64, cx: i64, cy: i64, fill: Option<&str>, line: Option<&str>, prst: &str) {
        let id = self.next();
        let fill_xml = match fill {
            Some(c) => format!(r#"<a:solidFill><a:srgbClr val="{c}"/></a:solidFill>"#),
            None => "<a:noFill/>".to_string(),
        };
        let line_xml = match line {
            Some(c) => format!(r#"<a:ln w="12700"><a:solidFill><a:srgbClr val="{c}"/></a:solidFill></a:ln>"#),
            None => String::new(),
        };
        self.shapes.push_str(&format!(
            r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="s{id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>{fill_xml}{line_xml}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>"#
        ));
    }

    fn text(&mut self, x: i64, y: i64, cx: i64, cy: i64, anchor: &str, paras: &str) {
        let id = self.next();
        self.shapes.push_str(&format!(
            r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="t{id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="{anchor}" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>{paras}</p:txBody></p:sp>"#
        ));
    }
}

fn run(text: &str, sz: i32, color: &str, bold: bool) -> String {
    format!(
        r#"<a:r><a:rPr lang="hu-HU" sz="{sz}"{b}><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="{FONT}"/></a:rPr><a:t>{txt}</a:t></a:r>"#,
        b = if bold { " b=\"1\"" } else { "" },
        txt = escape_xml(text)
    )
}

fn para(algn: &str, runs: &str) -> String {
    let pr = if algn.is_empty() { String::new() } else { format!(r#"<a:pPr algn="{algn}"/>"#) };
    format!("<a:p>{pr}{runs}</a:p>")
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn clip(text: &str, max: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        text.to_string()
    } else {
        let mut out: String = chars[..max.saturating_sub(1)].iter().collect();
        out.push('…');
        out
    }
}

// ── layout helpers ───────────────────────────────────────────────────────────

fn title_block(c: &mut Canvas, th: &Theme, slide: &Value, title_y: i64, title_sz: i32) {
    if let Some(kicker) = slide.get("kicker").and_then(Value::as_str) {
        c.text(M, title_y - 520_000, W - 2 * M, 380_000, "t", &para("", &run(&kicker.to_uppercase(), 1500, &th.accent, true)));
    }
    let title = s(slide, "title");
    c.text(M, title_y, W - 2 * M, 1_500_000, "t", &para("", &run(&clip(title, 90), title_sz, &th.text, true)));
    // accent underline
    c.shape(M, title_y + 1_180_000, 820_000, 60_000, Some(&th.accent), None, "rect");
}

fn footer(c: &mut Canvas, th: &Theme, deck_title: &str, index: usize, total: usize) {
    c.shape(M, H - 560_000, W - 2 * M, 12_700, Some(&th.border), None, "rect");
    c.text(M, H - 500_000, 6_000_000, 320_000, "t", &para("", &run(&clip(deck_title, 60), 1200, &th.muted, false)));
    c.text(W - M - 1_400_000, H - 500_000, 1_400_000, 320_000, "t", &para("r", &run(&format!("{} / {}", index + 1, total), 1200, &th.muted, false)));
}

fn render_slide(model: &Value, slide: &Value, index: usize, total: usize) -> String {
    let th = read_theme(model);
    let deck_title = s(model, "title");
    let mut c = Canvas::new();
    // full-bleed themed background
    c.shape(0, 0, W, H, Some(&th.background), None, "rect");
    let kind = slide.get("type").and_then(Value::as_str).unwrap_or("title");

    match kind {
        "title" => {
            c.shape(W - 2_400_000, -600_000, 3_000_000, 3_000_000, Some(&th.surface), None, "ellipse");
            if let Some(k) = slide.get("kicker").and_then(Value::as_str) {
                c.text(M, 1_900_000, W - 2 * M, 380_000, "t", &para("", &run(&k.to_uppercase(), 1700, &th.accent, true)));
            }
            c.text(M, 2_350_000, W - 2 * M, 2_000_000, "t", &para("", &run(&clip(s(slide, "title"), 80), 5400, &th.text, true)));
            c.shape(M, 4_350_000, 900_000, 70_000, Some(&th.accent), None, "rect");
            if let Some(sub) = slide.get("subtitle").and_then(Value::as_str) {
                c.text(M, 4_650_000, 9_000_000, 1_200_000, "t", &para("", &run(&clip(sub, 140), 2200, &th.muted, false)));
            }
        }
        "section" => {
            let marker = slide.get("marker").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("{:02}", index + 1));
            c.text(M, 900_000, 6_000_000, 3_000_000, "t", &para("", &run(&marker, 12000, &th.primary, true)));
            c.text(M, 4_300_000, W - 2 * M, 1_500_000, "t", &para("", &run(&clip(s(slide, "title"), 70), 4800, &th.text, true)));
            if let Some(sub) = slide.get("subtitle").and_then(Value::as_str) {
                c.text(M, 5_500_000, 9_000_000, 700_000, "t", &para("", &run(&clip(sub, 120), 2000, &th.muted, false)));
            }
        }
        "agenda" => {
            title_block(&mut c, &th, slide, 760_000, 3600);
            if let Some(items) = slide.get("items").and_then(Value::as_array) {
                for (i, item) in items.iter().filter_map(Value::as_str).take(6).enumerate() {
                    let y = 2_700_000 + i as i64 * 620_000;
                    c.shape(M, y, 420_000, 420_000, Some(&th.accent), None, "roundRect");
                    c.text(M, y + 70_000, 420_000, 320_000, "ctr", &para("ctr", &run(&format!("{}", i + 1), 1700, &th.on_accent, true)));
                    c.text(M + 560_000, y + 60_000, W - 2 * M - 560_000, 460_000, "t", &para("", &run(&clip(item, 80), 2100, &th.text, false)));
                }
            }
        }
        "bullets" => {
            title_block(&mut c, &th, slide, 760_000, 3600);
            if let Some(items) = slide.get("bullets").and_then(Value::as_array) {
                for (i, item) in items.iter().filter_map(Value::as_str).take(6).enumerate() {
                    let y = 2_650_000 + i as i64 * 560_000;
                    c.shape(M, y + 120_000, 150_000, 150_000, Some(&th.accent), None, "ellipse");
                    c.text(M + 360_000, y, W - 2 * M - 360_000, 520_000, "t", &para("", &run(&clip(item, 150), 2100, &th.text, false)));
                }
            }
        }
        "cards" => {
            title_block(&mut c, &th, slide, 760_000, 3600);
            if let Some(cards) = slide.get("cards").and_then(Value::as_array) {
                let cards: Vec<&Value> = cards.iter().take(4).collect();
                let n = cards.len().max(1) as i64;
                let gap = 260_000;
                let total_w = W - 2 * M;
                let cw = (total_w - gap * (n - 1)) / n;
                for (i, card) in cards.iter().enumerate() {
                    let x = M + i as i64 * (cw + gap);
                    let y = 2_700_000;
                    let ch = 2_700_000;
                    c.shape(x, y, cw, ch, Some(&th.surface), Some(&th.border), "roundRect");
                    c.shape(x + 280_000, y + 280_000, 520_000, 520_000, Some(&th.surface_alt), None, "roundRect");
                    c.text(x + 280_000, y + 980_000, cw - 560_000, 500_000, "t", &para("", &run(&clip(s(card, "title"), 48), 2000, &th.text, true)));
                    c.text(x + 280_000, y + 1_480_000, cw - 560_000, 1_100_000, "t", &para("", &run(&clip(s(card, "body"), 150), 1500, &th.muted, false)));
                }
            }
        }
        "metrics" => {
            title_block(&mut c, &th, slide, 760_000, 3600);
            if let Some(items) = slide.get("items").and_then(Value::as_array) {
                let items: Vec<&Value> = items.iter().take(4).collect();
                let n = items.len().max(1) as i64;
                let gap = 260_000;
                let cw = (W - 2 * M - gap * (n - 1)) / n;
                for (i, m) in items.iter().enumerate() {
                    let x = M + i as i64 * (cw + gap);
                    let y = 2_900_000;
                    c.shape(x, y, cw, 1_900_000, Some(&th.surface), Some(&th.border), "roundRect");
                    c.text(x + 300_000, y + 280_000, cw - 600_000, 900_000, "t", &para("", &run(&clip(s(m, "value"), 12), 4400, &th.accent, true)));
                    c.text(x + 300_000, y + 1_220_000, cw - 600_000, 420_000, "t", &para("", &run(&clip(s(m, "label"), 48), 1700, &th.text, true)));
                }
            }
        }
        "timeline" => {
            title_block(&mut c, &th, slide, 760_000, 3600);
            if let Some(steps) = slide.get("steps").and_then(Value::as_array) {
                let steps: Vec<&Value> = steps.iter().take(5).collect();
                let n = steps.len().max(1) as i64;
                let cw = (W - 2 * M) / n;
                let line_y = 3_000_000;
                c.shape(M + 110_000, line_y + 90_000, (n - 1) * cw, 36_000, Some(&th.border), None, "rect");
                for (i, step) in steps.iter().enumerate() {
                    let x = M + i as i64 * cw;
                    c.shape(x, line_y, 220_000, 220_000, Some(&th.accent), None, "ellipse");
                    if let Some(label) = step.get("label").and_then(Value::as_str) {
                        c.text(x, line_y + 380_000, cw - 200_000, 300_000, "t", &para("", &run(&label.to_uppercase(), 1300, &th.accent, true)));
                    }
                    c.text(x, line_y + 720_000, cw - 200_000, 500_000, "t", &para("", &run(&clip(s(step, "title"), 36), 1800, &th.text, true)));
                    c.text(x, line_y + 1_220_000, cw - 200_000, 1_100_000, "t", &para("", &run(&clip(s(step, "body"), 110), 1400, &th.muted, false)));
                }
            }
        }
        "process" => {
            title_block(&mut c, &th, slide, 760_000, 3600);
            if let Some(steps) = slide.get("steps").and_then(Value::as_array) {
                let steps: Vec<&Value> = steps.iter().take(4).collect();
                let n = steps.len().max(1) as i64;
                let arrow = 360_000;
                let cw = (W - 2 * M - arrow * (n - 1)) / n;
                for (i, step) in steps.iter().enumerate() {
                    let x = M + i as i64 * (cw + arrow);
                    let y = 3_000_000;
                    c.shape(x, y, cw, 1_900_000, Some(&th.surface), Some(&th.border), "roundRect");
                    c.text(x + 260_000, y + 240_000, cw - 520_000, 360_000, "t", &para("", &run(&format!("{:02}", i + 1), 1600, &th.accent, true)));
                    c.text(x + 260_000, y + 640_000, cw - 520_000, 460_000, "t", &para("", &run(&clip(s(step, "title"), 32), 1800, &th.text, true)));
                    c.text(x + 260_000, y + 1_120_000, cw - 520_000, 700_000, "t", &para("", &run(&clip(s(step, "body"), 100), 1400, &th.muted, false)));
                    if (i as i64) < n - 1 {
                        c.text(x + cw, y + 700_000, arrow, 500_000, "ctr", &para("ctr", &run("→", 2800, &th.accent, true)));
                    }
                }
            }
        }
        "comparison" => {
            title_block(&mut c, &th, slide, 760_000, 3600);
            let cols = slide.get("columns").and_then(Value::as_array).cloned().unwrap_or_default();
            let cols: Vec<&Value> = cols.iter().take(4).collect();
            let n = cols.len().max(1) as i64;
            let cw = (W - 2 * M) / n;
            let head_y = 2_700_000;
            for (i, col) in cols.iter().enumerate() {
                let x = M + i as i64 * cw;
                if i > 0 {
                    c.shape(x, head_y, cw - 60_000, 560_000, Some(&th.accent), None, "roundRect");
                }
                let color = if i == 0 { &th.text } else { &th.on_accent };
                c.text(x + 200_000, head_y + 140_000, cw - 360_000, 360_000, "t", &para("", &run(&clip(col.as_str().unwrap_or(""), 28), 1700, color, true)));
            }
            if let Some(rows) = slide.get("rows").and_then(Value::as_array) {
                for (r, row) in rows.iter().take(5).enumerate() {
                    let y = head_y + 700_000 + r as i64 * 560_000;
                    if r % 2 == 1 {
                        c.shape(M, y, W - 2 * M, 540_000, Some(&th.surface), None, "rect");
                    }
                    if let Some(cells) = row.as_array() {
                        for (i, cell) in cells.iter().take(n as usize).enumerate() {
                            let x = M + i as i64 * cw;
                            let color = if i == 0 { &th.text } else { &th.muted };
                            c.text(x + 200_000, y + 130_000, cw - 360_000, 360_000, "t", &para("", &run(&clip(cell.as_str().unwrap_or(""), 40), 1500, color, i == 0)));
                        }
                    }
                }
            }
        }
        "quote" => {
            c.text(M, 1_700_000, 2_000_000, 1_400_000, "t", &para("", &run("“", 9000, &th.accent, true)));
            c.text(M, 2_700_000, W - 2 * M - 600_000, 2_600_000, "t", &para("", &run(&clip(s(slide, "quote"), 220), 3200, &th.text, true)));
            if let Some(author) = slide.get("author").and_then(Value::as_str) {
                c.text(M, 5_400_000, 9_000_000, 500_000, "t", &para("", &run(&format!("— {}", clip(author, 60)), 1800, &th.muted, false)));
            }
        }
        "closing" => {
            c.shape(W / 2 - 1_900_000, H / 2 - 1_900_000, 3_800_000, 3_800_000, Some(&th.surface), None, "ellipse");
            if let Some(k) = slide.get("kicker").and_then(Value::as_str) {
                c.text(M, 2_200_000, W - 2 * M, 380_000, "ctr", &para("ctr", &run(&k.to_uppercase(), 1700, &th.accent, true)));
            }
            c.text(M, 2_750_000, W - 2 * M, 1_700_000, "ctr", &para("ctr", &run(&clip(s(slide, "title"), 80), 4600, &th.text, true)));
            if let Some(sub) = slide.get("subtitle").and_then(Value::as_str) {
                c.text(M, 4_500_000, W - 2 * M, 900_000, "ctr", &para("ctr", &run(&clip(sub, 150), 2000, &th.muted, false)));
            }
            if let Some(cta) = slide.get("cta").and_then(Value::as_str) {
                let cw = 3_400_000;
                c.shape(W / 2 - cw / 2, 5_500_000, cw, 620_000, Some(&th.accent), None, "roundRect");
                c.text(W / 2 - cw / 2, 5_660_000, cw, 360_000, "ctr", &para("ctr", &run(&clip(cta, 40), 1800, &th.on_accent, true)));
            }
        }
        _ => {
            c.text(M, 760_000, W - 2 * M, 1_200_000, "t", &para("", &run(&clip(s(slide, "title"), 90), 3600, &th.text, true)));
        }
    }

    if kind != "title" && kind != "closing" && kind != "section" {
        footer(&mut c, &th, deck_title, index, total);
    } else {
        c.text(W - M - 1_400_000, H - 460_000, 1_400_000, 320_000, "t", &para("r", &run(&format!("{} / {}", index + 1, total), 1200, &th.muted, false)));
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#,
        c.shapes
    )
}

pub fn write_pptx(path: &Path, model: &Value) -> Result<usize, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("pptx_mkdir_failed: {e}"))?;
    }
    let slides = model.get("slides").and_then(Value::as_array).cloned().unwrap_or_default();
    let slide_count = slides.len().max(1);
    let mut zip = ZipWriter::new(Cursor::new(Vec::<u8>::new()));
    let overrides = (1..=slide_count)
        .map(|i| format!(r#"<Override PartName="/ppt/slides/slide{}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>"#, i))
        .collect::<String>();
    write_entry(&mut zip, "[Content_Types].xml", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
{}
</Types>"#, overrides))?;
    write_entry(&mut zip, "_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"#)?;
    let rels = (1..=slide_count)
        .map(|i| format!(r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{}.xml"/>"#, i, i))
        .collect::<String>();
    write_entry(&mut zip, "ppt/_rels/presentation.xml.rels", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{}</Relationships>"#, rels))?;
    let sld_ids = (1..=slide_count)
        .map(|i| format!(r#"<p:sldId id="{}" r:id="rId{}"/>"#, 255 + i, i))
        .collect::<String>();
    write_entry(&mut zip, "ppt/presentation.xml", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>{}</p:sldIdLst><p:sldSz cx="{W}" cy="{H}" type="screen16x9"/></p:presentation>"#, sld_ids))?;
    for i in 0..slide_count {
        let fallback = serde_json::json!({ "type": "title", "title": model.get("title").and_then(Value::as_str).unwrap_or("Presentation") });
        let slide = slides.get(i).unwrap_or(&fallback);
        write_entry(&mut zip, &format!("ppt/slides/slide{}.xml", i + 1), &render_slide(model, slide, i, slide_count))?;
    }
    let bytes = zip.finish().map_err(|e| format!("pptx_finish_failed: {e}"))?.into_inner();
    std::fs::write(path, bytes).map_err(|e| format!("pptx_save_failed:{}: {e}", path.display()))?;
    Ok(slide_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn renders_themed_deck_with_accents() {
        let model = json!({
            "kind": "presentation", "title": "A Larund munkafolyamat", "language": "hu",
            "theme": { "background": "0B0E14", "surface": "171A21", "primary": "EE7E3A", "accent": "F4A261", "text": "F7EFE3", "mutedText": "A6AEBD", "border": "2A2F3A", "onAccent": "0B0E14" },
            "slides": [
                { "type": "title", "kicker": "LARUND", "title": "A Larund munkafolyamat", "subtitle": "Ötlettől működő funkcióig." },
                { "type": "timeline", "title": "A folyamat lépései", "steps": [
                    { "label": "01", "title": "Kérés", "body": "Cél megfogalmazása." },
                    { "label": "02", "title": "Ellenőrzés", "body": "Eredmény igazolása." }
                ]},
                { "type": "closing", "title": "Köszönöm a figyelmet", "cta": "Próbáld ki" }
            ]
        });
        let dir = std::env::temp_dir().join(format!("larund_pptx_test_{}", std::process::id()));
        let path = dir.join("deck.pptx");
        let count = write_pptx(&path, &model).expect("render pptx");
        assert_eq!(count, 3);
        let size = std::fs::metadata(&path).unwrap().len();
        assert!(size > 2500, "themed deck should be more than skeleton, got {size}");
        // unzip slide2 and confirm themed shapes + accented text survive
        let bytes = std::fs::read(&path).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut xml = String::new();
        {
            use std::io::Read;
            zip.by_name("ppt/slides/slide2.xml").unwrap().read_to_string(&mut xml).unwrap();
        }
        assert!(xml.contains("Ellenőrzés"), "accented step title missing");
        assert!(xml.contains("srgbClr"), "themed colors missing — slide is still skeleton");
        assert!(xml.contains("F4A261"), "accent color not applied");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
