// Premium invoice PDF renderer.
//
// Draws a designed, accent-safe invoice directly with vector primitives and an
// embedded TrueType font (see `font.rs`). This replaces the old "plain text in a
// PDF" output: brand header band, issuer/customer blocks, a dates strip, a
// zebra-striped line-item table, a totals panel with a highlighted amount due,
// and a footer — all with correct Hungarian accents.

use crate::artifacts::font::{resolve_fonts, EmbeddedFont};
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, Stream};
use serde_json::Value;
use std::path::Path;

const PAGE_W: f32 = 595.0;
const PAGE_H: f32 = 842.0;
const MARGIN: f32 = 48.0;
const RIGHT: f32 = PAGE_W - MARGIN;

type Rgb = (f32, f32, f32);

struct Palette {
    primary: Rgb,
    accent: Rgb,
    surface: Rgb,
    text: Rgb,
    muted: Rgb,
    border: Rgb,
    on_primary: Rgb,
}

fn hex_rgb(hex: &str, fallback: Rgb) -> Rgb {
    let h = hex.trim().trim_start_matches('#');
    if h.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&h[0..2], 16),
            u8::from_str_radix(&h[2..4], 16),
            u8::from_str_radix(&h[4..6], 16),
        ) {
            return (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
        }
    }
    fallback
}

fn palette(model: &Value) -> Palette {
    let brand = model.get("brand");
    let pick = |key: &str, fb: Rgb| {
        brand
            .and_then(|b| b.get(key))
            .and_then(Value::as_str)
            .map(|s| hex_rgb(s, fb))
            .unwrap_or(fb)
    };
    Palette {
        primary: pick("primaryColor", (0.118, 0.227, 0.541)),     // #1E3A8A
        accent: pick("accentColor", (0.149, 0.388, 0.922)),       // #2563EB
        surface: (0.945, 0.961, 0.976),                            // #F1F5F9
        text: (0.059, 0.090, 0.165),                               // #0F172A
        muted: (0.392, 0.455, 0.545),                              // #64748B
        border: (0.796, 0.835, 0.882),                             // #CBD5E1
        on_primary: (1.0, 1.0, 1.0),
    }
}

// ── low-level drawing ────────────────────────────────────────────────────────

fn set_fill(ops: &mut Vec<Operation>, c: Rgb) {
    ops.push(Operation::new("rg", vec![Object::Real(c.0), Object::Real(c.1), Object::Real(c.2)]));
}

/// Fill a rectangle whose top edge is `top` points from the page top.
fn fill_rect_top(ops: &mut Vec<Operation>, x: f32, top: f32, w: f32, h: f32, c: Rgb) {
    set_fill(ops, c);
    let y = PAGE_H - top - h;
    ops.push(Operation::new("re", vec![Object::Real(x), Object::Real(y), Object::Real(w), Object::Real(h)]));
    ops.push(Operation::new("f", vec![]));
}

/// Draw text with its baseline `baseline_top` points from the page top.
fn text(ops: &mut Vec<Operation>, font: &mut EmbeddedFont, x: f32, baseline_top: f32, size: f32, c: Rgb, s: &str) {
    let name = font.pdf_name().as_bytes().to_vec();
    let glyphs = font.encode(s);
    let y = PAGE_H - baseline_top;
    ops.push(Operation::new("BT", vec![]));
    set_fill(ops, c);
    ops.push(Operation::new("Tf", vec![Object::Name(name), Object::Real(size)]));
    ops.push(Operation::new(
        "Tm",
        vec![
            Object::Real(1.0), Object::Real(0.0), Object::Real(0.0), Object::Real(1.0),
            Object::Real(x), Object::Real(y),
        ],
    ));
    ops.push(Operation::new("Tj", vec![glyphs]));
    ops.push(Operation::new("ET", vec![]));
}

fn text_right(ops: &mut Vec<Operation>, font: &mut EmbeddedFont, right_x: f32, baseline_top: f32, size: f32, c: Rgb, s: &str) {
    let w = font.width(s, size);
    text(ops, font, right_x - w, baseline_top, size, c, s);
}

// ── value helpers ────────────────────────────────────────────────────────────

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|t| t.replace([' ', '\u{00A0}'], "").parse().ok())))
}

fn group3(n: i64) -> String {
    let neg = n < 0;
    let digits = n.abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push(' ');
        }
        out.push(ch);
    }
    let grouped: String = out.chars().rev().collect();
    if neg { format!("-{grouped}") } else { grouped }
}

fn fmt_amount(v: f64, currency: &str) -> String {
    let n = v.round() as i64;
    match currency {
        "EUR" => format!("€ {}", group3(n)),
        "USD" => format!("$ {}", group3(n)),
        _ => format!("{} Ft", group3(n)),
    }
}

struct Party {
    name: String,
    lines: Vec<String>,
    tax_id: Option<String>,
    email: Option<String>,
}

fn read_party(v: Option<&Value>) -> Party {
    let v = v.cloned().unwrap_or(Value::Null);
    let mut lines: Vec<String> = Vec::new();
    if let Some(arr) = v.get("addressLines").and_then(Value::as_array) {
        lines.extend(arr.iter().filter_map(Value::as_str).map(str::to_string));
    } else if let Some(addr) = v.get("address").and_then(Value::as_str) {
        lines.extend(addr.split('\n').map(|l| l.trim().to_string()).filter(|l| !l.is_empty()));
    }
    Party {
        name: s(&v, "name").to_string(),
        lines,
        tax_id: v.get("taxId").and_then(Value::as_str).map(str::to_string).filter(|t| !t.is_empty()),
        email: v.get("email").and_then(Value::as_str).map(str::to_string).filter(|t| !t.is_empty()),
    }
}

fn party_block(ops: &mut Vec<Operation>, reg: &mut EmbeddedFont, bold: &mut EmbeddedFont, pal: &Palette, x: f32, top: f32, label: &str, party: &Party) {
    text(ops, bold, x, top, 9.0, pal.muted, &label.to_uppercase());
    fill_rect_top(ops, x, top + 6.0, 26.0, 2.0, pal.accent);
    let mut y = top + 24.0;
    text(ops, bold, x, y, 12.5, pal.text, &party.name);
    y += 16.0;
    for line in &party.lines {
        text(ops, reg, x, y, 9.5, pal.muted, line);
        y += 13.0;
    }
    if let Some(tax) = &party.tax_id {
        text(ops, reg, x, y, 9.5, pal.muted, &format!("Adószám: {tax}"));
        y += 13.0;
    }
    if let Some(email) = &party.email {
        text(ops, reg, x, y, 9.5, pal.muted, email);
    }
}

fn date_cell(ops: &mut Vec<Operation>, reg: &mut EmbeddedFont, bold: &mut EmbeddedFont, pal: &Palette, x: f32, top: f32, w: f32, label: &str, value: &str) {
    fill_rect_top(ops, x, top, w, 50.0, pal.surface);
    text(ops, reg, x + 12.0, top + 19.0, 8.0, pal.muted, &label.to_uppercase());
    text(ops, bold, x + 12.0, top + 36.0, 11.0, pal.text, if value.is_empty() { "—" } else { value });
}

/// Render an invoice model to a designed PDF. Returns the page count.
pub fn write_invoice_pdf(path: &Path, model: &Value) -> Result<usize, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("invoice_mkdir_failed: {e}"))?;
    }
    let (reg_path, bold_path) = resolve_fonts()?;
    let mut reg = EmbeddedFont::load(&reg_path, "LarundSans", "F1")?;
    let mut bold = EmbeddedFont::load(&bold_path, "LarundSansBold", "F2")?;
    let pal = palette(model);
    let currency = {
        let c = s(model, "currency");
        if c.is_empty() { "HUF" } else { c }
    };
    let test_mode = model.get("testMode").and_then(Value::as_bool).unwrap_or(false);

    let mut ops: Vec<Operation> = Vec::new();

    // ── brand header band ────────────────────────────────────────────────────
    fill_rect_top(&mut ops, 0.0, 0.0, PAGE_W, 140.0, pal.primary);
    let issuer = read_party(model.get("issuer"));
    let customer = read_party(model.get("customer"));
    let brand_name = model
        .get("brand")
        .and_then(|b| b.get("name"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| if issuer.name.is_empty() { "Larund".to_string() } else { issuer.name.clone() });
    text(&mut ops, &mut bold, MARGIN, 60.0, 20.0, pal.on_primary, &brand_name);
    if let Some(email) = issuer.email.clone().or_else(|| issuer.lines.first().cloned()) {
        text(&mut ops, &mut reg, MARGIN, 82.0, 9.5, (0.86, 0.90, 0.98), &email);
    }
    text_right(&mut ops, &mut bold, RIGHT, 62.0, 30.0, pal.on_primary, "SZÁMLA");
    let invoice_no = s(model, "invoiceNumber");
    if !invoice_no.is_empty() {
        text_right(&mut ops, &mut reg, RIGHT, 84.0, 10.5, (0.86, 0.90, 0.98), &format!("Sorszám: {invoice_no}"));
    }
    if test_mode {
        let badge = "TESZT / MINTA";
        let bw = reg.width(badge, 8.5) + 16.0;
        fill_rect_top(&mut ops, RIGHT - bw, 96.0, bw, 18.0, pal.accent);
        text_right(&mut ops, &mut bold, RIGHT - 8.0, 109.0, 8.5, pal.on_primary, badge);
    }

    // ── issuer / customer ────────────────────────────────────────────────────
    let block_top = 180.0;
    party_block(&mut ops, &mut reg, &mut bold, &pal, MARGIN, block_top, "Kibocsátó", &issuer);
    party_block(&mut ops, &mut reg, &mut bold, &pal, 320.0, block_top, "Vevő", &customer);

    // ── dates strip ──────────────────────────────────────────────────────────
    let dates_top = 300.0;
    let cell_w = (RIGHT - MARGIN - 3.0 * 10.0) / 4.0;
    let cells = [
        ("Számla kelte", s(model, "issueDate")),
        ("Teljesítés dátuma", s(model, "fulfillmentDate")),
        ("Fizetési határidő", s(model, "dueDate")),
        ("Fizetési mód", s(model, "paymentMethod")),
    ];
    for (i, (label, value)) in cells.iter().enumerate() {
        let x = MARGIN + i as f32 * (cell_w + 10.0);
        date_cell(&mut ops, &mut reg, &mut bold, &pal, x, dates_top, cell_w, label, value);
    }

    // ── line items table ─────────────────────────────────────────────────────
    let table_top = 380.0;
    let col_desc = MARGIN + 12.0;
    let col_qty_r = 360.0;
    let col_unit_r = 460.0;
    let col_net_r = RIGHT - 12.0;
    let header_h = 26.0;
    fill_rect_top(&mut ops, MARGIN, table_top, RIGHT - MARGIN, header_h, pal.primary);
    let head_base = table_top + 17.0;
    text(&mut ops, &mut bold, col_desc, head_base, 9.5, pal.on_primary, "MEGNEVEZÉS");
    text_right(&mut ops, &mut bold, col_qty_r, head_base, 9.5, pal.on_primary, "MENNY.");
    text_right(&mut ops, &mut bold, col_unit_r, head_base, 9.5, pal.on_primary, "EGYSÉGÁR");
    text_right(&mut ops, &mut bold, col_net_r, head_base, 9.5, pal.on_primary, "NETTÓ");

    let empty: Vec<Value> = Vec::new();
    let items = model.get("lineItems").and_then(Value::as_array).unwrap_or(&empty);
    let row_h = 24.0;
    let mut computed_net = 0.0f64;
    let mut y = table_top + header_h;
    for (i, item) in items.iter().take(18).enumerate() {
        if i % 2 == 1 {
            fill_rect_top(&mut ops, MARGIN, y, RIGHT - MARGIN, row_h, pal.surface);
        }
        let qty = num(item, "quantity").unwrap_or(1.0);
        let unit = num(item, "unitPrice").unwrap_or(0.0);
        let net = num(item, "net").unwrap_or(qty * unit);
        computed_net += net;
        let base = y + 16.0;
        let desc = s(item, "description");
        let desc = if desc.is_empty() { s(item, "name") } else { desc };
        let max_desc = col_qty_r - col_desc - 50.0;
        let clipped = reg.wrap(desc, 9.5, max_desc).into_iter().next().unwrap_or_default();
        text(&mut ops, &mut reg, col_desc, base, 9.5, pal.text, &clipped);
        let qty_str = if qty.fract() == 0.0 { format!("{}", qty as i64) } else { format!("{qty}") };
        let unit_label = item.get("unit").and_then(Value::as_str).unwrap_or("");
        text_right(&mut ops, &mut reg, col_qty_r, base, 9.5, pal.muted, &format!("{qty_str} {unit_label}").trim().to_string());
        text_right(&mut ops, &mut reg, col_unit_r, base, 9.5, pal.muted, &fmt_amount(unit, currency));
        text_right(&mut ops, &mut bold, col_net_r, base, 9.5, pal.text, &fmt_amount(net, currency));
        y += row_h;
    }
    // bottom rule of the table
    fill_rect_top(&mut ops, MARGIN, y, RIGHT - MARGIN, 1.0, pal.border);

    // ── totals panel ─────────────────────────────────────────────────────────
    let totals = model.get("totals");
    let net_total = totals.and_then(|t| num(t, "net")).unwrap_or(computed_net);
    let vat_rate = num(model, "vatRate").unwrap_or(27.0);
    let vat_total = totals.and_then(|t| num(t, "vat")).unwrap_or(net_total * vat_rate / 100.0);
    let gross_total = totals.and_then(|t| num(t, "gross")).unwrap_or(net_total + vat_total);

    let panel_x = 330.0;
    let panel_w = RIGHT - panel_x;
    let mut ty = y + 18.0;
    let label_x = panel_x + 14.0;
    let value_r = RIGHT - 14.0;
    text(&mut ops, &mut reg, label_x, ty + 12.0, 10.0, pal.muted, "Nettó összesen");
    text_right(&mut ops, &mut reg, value_r, ty + 12.0, 10.5, pal.text, &fmt_amount(net_total, currency));
    ty += 22.0;
    text(&mut ops, &mut reg, label_x, ty + 12.0, 10.0, pal.muted, &format!("ÁFA ({}%)", vat_rate.round() as i64));
    text_right(&mut ops, &mut reg, value_r, ty + 12.0, 10.5, pal.text, &fmt_amount(vat_total, currency));
    ty += 26.0;
    // highlighted amount due
    fill_rect_top(&mut ops, panel_x, ty, panel_w, 40.0, pal.accent);
    text(&mut ops, &mut bold, label_x, ty + 25.0, 11.0, pal.on_primary, "FIZETENDŐ");
    text_right(&mut ops, &mut bold, value_r, ty + 25.0, 15.0, pal.on_primary, &fmt_amount(gross_total, currency));

    // ── footer ───────────────────────────────────────────────────────────────
    let footer_top = PAGE_H - 70.0;
    fill_rect_top(&mut ops, MARGIN, footer_top, RIGHT - MARGIN, 1.0, pal.border);
    let notes = s(model, "notes");
    let note_text = if !notes.is_empty() {
        notes.to_string()
    } else if test_mode {
        "Ez egy automatikusan generált teszt számla, valós könyvelési értéke nincs.".to_string()
    } else {
        "Köszönjük, hogy minket választott.".to_string()
    };
    for (i, line) in reg.wrap(&note_text, 9.0, RIGHT - MARGIN).into_iter().take(2).enumerate() {
        text(&mut ops, &mut reg, MARGIN, footer_top + 18.0 + i as f32 * 12.0, 9.0, pal.muted, &line);
    }

    // ── assemble document ────────────────────────────────────────────────────
    let mut doc = Document::with_version("1.7");
    let f1 = reg.add_to_doc(&mut doc);
    let f2 = bold.add_to_doc(&mut doc);
    let resources = doc.add_object(dictionary! {
        "Font" => dictionary! { "F1" => f1, "F2" => f2 },
    });
    let content = Content { operations: ops };
    let mut stream = Stream::new(dictionary! {}, content.encode().map_err(|e| e.to_string())?);
    stream.compress().ok();
    let content_id = doc.add_object(stream);
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Contents" => content_id,
        "Resources" => resources,
        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
    });
    let pages_id = doc.add_object(dictionary! {
        "Type" => "Pages",
        "Kids" => vec![Object::Reference(page_id)],
        "Count" => 1,
    });
    if let Ok(Object::Dictionary(page)) = doc.get_object_mut(page_id) {
        page.set("Parent", pages_id);
    }
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    doc.compress();
    doc.save(path).map_err(|e| format!("invoice_save_failed:{}: {e}", path.display()))?;
    Ok(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn renders_invoice_with_correct_accents() {
        let model = json!({
            "kind": "invoice", "testMode": true, "language": "hu",
            "invoiceNumber": "TESZT-2026-0042", "currency": "HUF", "vatRate": 27,
            "issuer": { "name": "Larund Click Kft.", "addressLines": ["1051 Budapest, Példa utca 12."], "taxId": "12345678-2-41", "email": "szamlazas@larund.click" },
            "customer": { "name": "Minta Ügyfél Zrt.", "taxId": "87654321-2-42" },
            "issueDate": "2026-06-21", "dueDate": "2026-06-29", "paymentMethod": "Átutalás",
            "lineItems": [{ "description": "Larund Click éves előfizetés", "quantity": 1, "unit": "db", "unitPrice": 120000 }],
            "notes": "Teszt számla"
        });
        let dir = std::env::temp_dir().join(format!("larund_inv_test_{}", std::process::id()));
        let path = dir.join("szamla.pdf");
        write_invoice_pdf(&path, &model).expect("render invoice");

        let size = std::fs::metadata(&path).unwrap().len();
        assert!(size > 5000, "designed invoice should be well over 5 KB, got {size}");
        let raw = std::fs::read(&path).unwrap();
        assert!(String::from_utf8_lossy(&raw).contains("FontFile2"), "font program must be embedded");

        let text = crate::artifacts::pdf::extract_pdf_text(&path).expect("extract text").to_lowercase();
        for needle in ["számla", "fizetendő", "kibocsátó", "vevő", "áfa"] {
            assert!(text.contains(needle), "extracted text is missing '{needle}': {text}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
