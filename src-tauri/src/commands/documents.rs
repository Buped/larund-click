use std::io::{Cursor, Read, Write};
use std::path::Path;
use base64::Engine as _;
use zip::{write::FileOptions, ZipArchive, ZipWriter};

fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            return path.replacen('~', &home.to_string_lossy(), 1);
        }
    }
    path.to_string()
}

fn xml_unescape(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn strip_xml_text(xml: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    let mut last_was_space = true;
    for ch in xml.chars() {
        match ch {
            '<' => {
                in_tag = true;
                if !last_was_space {
                    out.push(' ');
                    last_was_space = true;
                }
            }
            '>' => in_tag = false,
            _ if !in_tag => {
                let decoded = ch;
                if decoded.is_whitespace() {
                    if !last_was_space {
                        out.push(' ');
                        last_was_space = true;
                    }
                } else {
                    out.push(decoded);
                    last_was_space = false;
                }
            }
            _ => {}
        }
    }
    xml_unescape(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_zip_xml_text(bytes: &[u8], wanted: impl Fn(&str) -> bool) -> Result<String, String> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("zip_open_failed: {e}"))?;
    let mut parts: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if !wanted(&name) {
            continue;
        }
        let mut xml = String::new();
        file.read_to_string(&mut xml)
            .map_err(|e| format!("xml_read_failed:{name}: {e}"))?;
        let text = strip_xml_text(&xml);
        if !text.trim().is_empty() {
            parts.push(text);
        }
    }
    let text = parts.join("\n");
    if text.trim().is_empty() {
        Err("no_text_extracted".to_string())
    } else {
        Ok(text)
    }
}

fn decode_pdf_literal(raw: &str) -> String {
    let mut out = String::new();
    let mut escape = false;
    for ch in raw.chars() {
        if escape {
            match ch {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                '(' => out.push('('),
                ')' => out.push(')'),
                '\\' => out.push('\\'),
                other => out.push(other),
            }
            escape = false;
        } else if ch == '\\' {
            escape = true;
        } else {
            out.push(ch);
        }
    }
    out
}

/// Legacy literal-text scanner. Only finds UNCOMPRESSED `(text) Tj` operators, so it
/// fails on the vast majority of real PDFs (whose content streams are FlateDecode
/// compressed). Kept only as a last-resort fallback behind the robust extractor.
fn extract_pdf_literal(bytes: &[u8]) -> Result<String, String> {
    let data = String::from_utf8_lossy(bytes);
    let mut parts: Vec<String> = Vec::new();
    let chars: Vec<char> = data.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '(' {
            let mut j = i + 1;
            let mut raw = String::new();
            let mut escape = false;
            while j < chars.len() {
                let ch = chars[j];
                if escape {
                    raw.push('\\');
                    raw.push(ch);
                    escape = false;
                } else if ch == '\\' {
                    escape = true;
                } else if ch == ')' {
                    break;
                } else {
                    raw.push(ch);
                }
                j += 1;
            }
            if j < chars.len() {
                let tail: String = chars[j + 1..chars.len().min(j + 16)].iter().collect();
                if tail.contains("Tj")
                    || tail.contains("TJ")
                    || tail.contains("'")
                    || tail.contains("\"")
                {
                    let text = decode_pdf_literal(&raw);
                    if text.chars().any(|c| c.is_alphabetic()) {
                        parts.push(text);
                    }
                }
                i = j;
            }
        }
        i += 1;
    }
    let text = parts.join(" ");
    if text.trim().is_empty() {
        Err("pdf_text_extraction_failed: no literal text objects found".to_string())
    } else {
        Ok(text.split_whitespace().collect::<Vec<_>>().join(" "))
    }
}

// ── PDF: robust text + image extraction ────────────────────────────────────────
// Tier 1 (local, $0 tokens): pdf-extract decodes FlateDecode content streams and font
// encodings — the case the legacy scanner could not handle. Tier 2 (fallback): when a
// PDF carries no extractable text (scanned/image-only), pull embedded page images so
// the model can read them with vision. See docs/LARUND_OPERATOR_BENCHMARKS.md.

/// Largest PDF we will attempt (protects against pathological/huge files).
const MAX_PDF_BYTES: usize = 64 * 1024 * 1024;
/// Page images to surface for a scanned PDF (economy: caps vision token cost).
const MAX_PDF_IMAGES: usize = 8;
/// Skip an individual embedded image larger than this (protects the model context).
const MAX_PDF_IMAGE_BYTES: usize = 3 * 1024 * 1024;

/// True when extracted text is substantial enough to treat the PDF as text (vs scanned).
fn text_is_sufficient(text: &str, page_count: usize) -> bool {
    let alpha = text.chars().filter(|c| c.is_alphanumeric()).count();
    // ~20 alphanumeric chars per page, with a small absolute floor.
    alpha >= 16 && alpha >= 12 * page_count.max(1)
}

/// Robust PDF text extraction. Tries pdf-extract (panic-guarded), then the legacy
/// literal scanner. Returns the best text found (possibly empty for scanned PDFs).
fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_PDF_BYTES {
        return Err("pdf_too_large".to_string());
    }
    // pdf-extract can panic on malformed PDFs — isolate it.
    let owned = bytes.to_vec();
    let robust = std::panic::catch_unwind(move || pdf_extract::extract_text_from_mem(&owned))
        .ok()
        .and_then(|r| r.ok())
        .map(|t| t.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|t| !t.trim().is_empty());
    if let Some(text) = robust {
        return Ok(text);
    }
    // Fall back to the literal scanner (uncompressed PDFs); may also be empty.
    extract_pdf_literal(bytes).or_else(|_| Ok(String::new()))
}

/// Number of pages in a PDF (best-effort; 0 on parse failure).
fn pdf_page_count(bytes: &[u8]) -> usize {
    let owned = bytes.to_vec();
    std::panic::catch_unwind(move || {
        lopdf::Document::load_mem(&owned)
            .map(|d| d.get_pages().len())
            .unwrap_or(0)
    })
    .unwrap_or(0)
}

/// Resolve a PDF object that may be a reference to its underlying object.
fn deref<'a>(doc: &'a lopdf::Document, obj: &'a lopdf::Object) -> &'a lopdf::Object {
    match obj {
        lopdf::Object::Reference(id) => doc.get_object(*id).unwrap_or(obj),
        _ => obj,
    }
}

/// Extract embedded page images from a (scanned) PDF as base64 data URLs. DCTDecode
/// (JPEG) is passed through unchanged; simple FlateDecode DeviceRGB/DeviceGray rasters
/// are re-encoded to PNG. Other/exotic image types are skipped. Capped for economy.
fn extract_pdf_images(bytes: &[u8]) -> Vec<String> {
    let owned = bytes.to_vec();
    std::panic::catch_unwind(move || {
        let mut out: Vec<String> = Vec::new();
        let Ok(doc) = lopdf::Document::load_mem(&owned) else {
            return out;
        };
        for (_id, obj) in doc.objects.iter() {
            if out.len() >= MAX_PDF_IMAGES {
                break;
            }
            let lopdf::Object::Stream(stream) = obj else { continue };
            let dict = &stream.dict;
            let is_image = dict
                .get(b"Subtype")
                .ok()
                .map(|s| deref(&doc, s))
                .and_then(|s| s.as_name().ok())
                .map(|n| n == b"Image")
                .unwrap_or(false);
            if !is_image {
                continue;
            }
            // Collect filter name(s): may be a single Name or an Array of Names.
            let filters: Vec<Vec<u8>> = match dict.get(b"Filter").map(|f| deref(&doc, f)) {
                Ok(lopdf::Object::Name(n)) => vec![n.clone()],
                Ok(lopdf::Object::Array(a)) => a
                    .iter()
                    .filter_map(|x| deref(&doc, x).as_name().ok().map(|n| n.to_vec()))
                    .collect(),
                _ => Vec::new(),
            };
            let is_jpeg = filters.iter().any(|f| f == b"DCTDecode");

            if is_jpeg {
                // The raw stream content IS the JPEG bitstream.
                if !stream.content.is_empty() && stream.content.len() <= MAX_PDF_IMAGE_BYTES {
                    out.push(format!(
                        "data:image/jpeg;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(&stream.content)
                    ));
                }
                continue;
            }

            // FlateDecode raster → re-encode to PNG for DeviceRGB / DeviceGray, 8 bpc.
            let only_flate = !filters.is_empty() && filters.iter().all(|f| f == b"FlateDecode");
            if !only_flate {
                continue;
            }
            let width = dict.get(b"Width").ok().and_then(|w| deref(&doc, w).as_i64().ok());
            let height = dict.get(b"Height").ok().and_then(|h| deref(&doc, h).as_i64().ok());
            let bpc = dict
                .get(b"BitsPerComponent")
                .ok()
                .and_then(|b| deref(&doc, b).as_i64().ok())
                .unwrap_or(8);
            let cs = dict
                .get(b"ColorSpace")
                .ok()
                .map(|c| deref(&doc, c))
                .and_then(|c| c.as_name().ok())
                .map(|n| n.to_vec());
            let (Some(w), Some(h)) = (width, height) else { continue };
            if bpc != 8 || w <= 0 || h <= 0 {
                continue;
            }
            let Ok(raw) = stream.decompressed_content() else { continue };
            let (w, h) = (w as u32, h as u32);
            let png = if cs.as_deref() == Some(b"DeviceRGB".as_slice()) {
                image::RgbImage::from_raw(w, h, raw).map(image::DynamicImage::ImageRgb8)
            } else if cs.as_deref() == Some(b"DeviceGray".as_slice()) {
                image::GrayImage::from_raw(w, h, raw).map(image::DynamicImage::ImageLuma8)
            } else {
                None
            };
            if let Some(img) = png {
                let mut buf = Cursor::new(Vec::<u8>::new());
                if img.write_to(&mut buf, image::ImageFormat::Png).is_ok() {
                    let data = buf.into_inner();
                    if data.len() <= MAX_PDF_IMAGE_BYTES {
                        out.push(format!(
                            "data:image/png;base64,{}",
                            base64::engine::general_purpose::STANDARD.encode(&data)
                        ));
                    }
                }
            }
        }
        out
    })
    .unwrap_or_default()
}

/// Rich document extraction. Returns JSON: `{ method, text, pageCount, images: [dataUrl] }`.
/// `method` is "text" (local extraction succeeded), "image" (scanned → page images for
/// vision), or "empty". Text extraction is always tried first ($0 tokens); images are a
/// page-capped fallback only when there is no usable text.
#[tauri::command]
pub async fn document_extract_rich(path: String) -> Result<String, String> {
    let expanded = expand_tilde(&path);
    let ext = Path::new(&expanded)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let bytes =
        std::fs::read(&expanded).map_err(|e| format!("document_read_failed:{path}: {e}"))?;

    let (method, text, page_count, images): (&str, String, usize, Vec<String>) = match ext.as_str()
    {
        "pdf" => {
            let pages = pdf_page_count(&bytes);
            let text = extract_pdf_text(&bytes).unwrap_or_default();
            if text_is_sufficient(&text, pages) {
                ("text", text, pages, Vec::new())
            } else {
                let images = extract_pdf_images(&bytes);
                if images.is_empty() {
                    if text.trim().is_empty() {
                        ("empty", text, pages, images)
                    } else {
                        ("text", text, pages, images)
                    }
                } else {
                    ("image", text, pages, images)
                }
            }
        }
        "docx" | "pptx" | "doc" => {
            let text = document_extract_text(path.clone()).await.unwrap_or_default();
            let method = if text.trim().is_empty() { "empty" } else { "text" };
            (method, text, 0, Vec::new())
        }
        _ => {
            let text = document_extract_text(path.clone()).await.unwrap_or_default();
            let method = if text.trim().is_empty() { "empty" } else { "text" };
            (method, text, 0, Vec::new())
        }
    };

    let payload = serde_json::json!({
        "method": method,
        "text": text,
        "pageCount": page_count,
        "images": images,
    });
    Ok(payload.to_string())
}

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn document_xml(
    title: Option<&str>,
    content: &str,
    tables: Option<Vec<Vec<Vec<String>>>>,
) -> String {
    let mut body = String::new();
    if let Some(title) = title.filter(|t| !t.trim().is_empty()) {
        body.push_str(&format!(
            "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>",
            escape_xml(title)
        ));
    }
    for para in content.split('\n') {
        body.push_str(&format!(
            "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
            escape_xml(para)
        ));
    }
    if let Some(tables) = tables {
        for table in tables {
            body.push_str("<w:tbl>");
            for row in table {
                body.push_str("<w:tr>");
                for cell in row {
                    body.push_str(&format!(
                        "<w:tc><w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p></w:tc>",
                        escape_xml(&cell)
                    ));
                }
                body.push_str("</w:tr>");
            }
            body.push_str("</w:tbl>");
        }
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>{}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>"#,
        body
    )
}

fn write_zip_entry(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    content: &str,
) -> Result<(), String> {
    zip.start_file(name, FileOptions::default())
        .map_err(|e| format!("zip_entry_failed:{name}: {e}"))?;
    zip.write_all(content.as_bytes())
        .map_err(|e| format!("zip_write_failed:{name}: {e}"))
}

#[tauri::command]
pub async fn document_extract_text(path: String) -> Result<String, String> {
    let expanded = expand_tilde(&path);
    let ext = Path::new(&expanded)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let bytes =
        std::fs::read(&expanded).map_err(|e| format!("document_read_failed:{path}: {e}"))?;
    match ext.as_str() {
        "docx" => extract_zip_xml_text(&bytes, |name| {
            name == "word/document.xml"
                || name.starts_with("word/header")
                || name.starts_with("word/footer")
        }),
        "pptx" => extract_zip_xml_text(&bytes, |name| {
            name.starts_with("ppt/slides/slide") && name.ends_with(".xml")
        }),
        "pdf" => extract_pdf_text(&bytes),
        "doc" => Err("unsupported_legacy_doc: convert .doc to .docx first".to_string()),
        _ => Err(format!("unsupported_document_extract_format:{ext}")),
    }
}

#[tauri::command]
pub async fn docx_write(
    path: String,
    content: String,
    title: Option<String>,
    tables: Option<Vec<Vec<Vec<String>>>>,
) -> Result<String, String> {
    let expanded = expand_tilde(&path);
    if let Some(parent) = Path::new(&expanded).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("docx_mkdir_failed: {e}"))?;
    }

    let cursor = Cursor::new(Vec::<u8>::new());
    let mut zip = ZipWriter::new(cursor);
    write_zip_entry(
        &mut zip,
        "[Content_Types].xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "word/_rels/document.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "word/document.xml",
        &document_xml(title.as_deref(), &content, tables),
    )?;
    let bytes = zip
        .finish()
        .map_err(|e| format!("zip_finish_failed: {e}"))?
        .into_inner();
    std::fs::write(&expanded, bytes).map_err(|e| format!("docx_write_failed:{path}: {e}"))?;
    Ok(format!("Wrote DOCX document {path}"))
}

#[tauri::command]
pub async fn file_write_bytes(path: String, bytes: Vec<u8>) -> Result<String, String> {
    let expanded = expand_tilde(&path);
    if let Some(parent) = Path::new(&expanded).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir_failed: {e}"))?;
    }
    std::fs::write(&expanded, bytes).map_err(|e| format!("file_write_bytes_failed:{path}: {e}"))?;
    Ok(format!("Wrote binary file {path}"))
}

#[tauri::command]
pub async fn file_read_bytes(path: String) -> Result<Vec<u8>, String> {
    let expanded = expand_tilde(&path);
    std::fs::read(&expanded).map_err(|e| format!("file_read_bytes_failed:{path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Dictionary, Document, Object, Stream};

    #[test]
    fn text_sufficiency_heuristic() {
        assert!(text_is_sufficient("This is a reasonably long invoice text", 1));
        assert!(!text_is_sufficient("", 1));
        assert!(!text_is_sufficient("ab", 1));
        // A few words are not enough to call a 10-page PDF "text".
        assert!(!text_is_sufficient("short note", 10));
    }

    #[test]
    fn literal_scanner_reads_uncompressed_text() {
        let pdf = b"%PDF-1.4\nBT /F1 12 Tf (Hello Invoice 2026) Tj ET\n%%EOF";
        let text = extract_pdf_literal(pdf).expect("should find literal text");
        assert!(text.contains("Hello Invoice 2026"), "got: {text}");
    }

    #[test]
    fn robust_extractor_reads_compressed_text_pdf() {
        // The real-world case the legacy scanner failed on: a FlateDecode-compressed
        // content stream. pdf-extract must recover the text.
        use lopdf::content::{Content, Operation};

        let mut doc = Document::with_version("1.5");
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 24.into()]),
                Operation::new("Td", vec![72.into(), 720.into()]),
                Operation::new("Tj", vec![Object::string_literal("Compressed Invoice 2026")]),
                Operation::new("ET", vec![]),
            ],
        };
        let mut stream = Stream::new(Dictionary::new(), content.encode().unwrap());
        stream.compress().ok();
        let content_id = doc.add_object(stream);
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Contents" => content_id,
            "Resources" => resources_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        });
        if let Ok(Object::Dictionary(page)) = doc.get_object_mut(page_id) {
            page.set("Parent", pages_id);
        }
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);

        let mut buf = Vec::new();
        doc.save_to(&mut buf).expect("save pdf");

        let text = extract_pdf_text(&buf).expect("text from compressed pdf");
        assert!(text.contains("Compressed Invoice"), "got: {text}");
    }

    #[test]
    fn extract_images_from_scanned_pdf_jpeg() {
        // Build a minimal but valid PDF whose single page is a DCTDecode (JPEG) image,
        // i.e. a "scanned" page. extract_pdf_images must pass the JPEG through as a
        // base64 data URL.
        let mut doc = Document::with_version("1.5");

        let mut img = Dictionary::new();
        img.set("Type", Object::Name(b"XObject".to_vec()));
        img.set("Subtype", Object::Name(b"Image".to_vec()));
        img.set("Width", Object::Integer(2));
        img.set("Height", Object::Integer(2));
        img.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        let jpeg = b"\xFF\xD8\xFF\xE0\x00\x10JFIFFAKE\xFF\xD9".to_vec();
        let image_id = doc.add_object(Stream::new(img, jpeg));

        let resources_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "Im0" => image_id },
        });
        let content_id = doc.add_object(Stream::new(
            Dictionary::new(),
            b"q 2 0 0 2 0 0 cm /Im0 Do Q".to_vec(),
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Contents" => content_id,
            "Resources" => resources_id,
            "MediaBox" => vec![0.into(), 0.into(), 2.into(), 2.into()],
        });
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        });
        if let Ok(Object::Dictionary(page)) = doc.get_object_mut(page_id) {
            page.set("Parent", pages_id);
        }
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);

        let mut buf = Vec::new();
        doc.save_to(&mut buf).expect("save pdf");

        let images = extract_pdf_images(&buf);
        assert_eq!(images.len(), 1, "expected one embedded page image");
        assert!(images[0].starts_with("data:image/jpeg;base64,"), "got: {}", &images[0][..40.min(images[0].len())]);
    }
}

fn mime_for_image_ext(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// Read an image file and return a ready-to-use base64 `data:` URL so the agent
/// can pass it directly to a vision-capable model. Returns an error for files
/// larger than `max_bytes` (caller-supplied, default 4 MiB) to protect the
/// model context window, and for non-image extensions.
#[tauri::command]
pub async fn file_read_base64(path: String, max_bytes: Option<u64>) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let expanded = expand_tilde(&path);
    let ext = Path::new(&expanded)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let mime = mime_for_image_ext(ext)
        .ok_or_else(|| format!("unsupported_image_ext:{ext}"))?;

    let limit = max_bytes.unwrap_or(4 * 1024 * 1024);
    let meta = std::fs::metadata(&expanded)
        .map_err(|e| format!("file_read_base64_stat_failed:{path}: {e}"))?;
    if meta.len() > limit {
        return Err(format!("image_too_large:{}:{}>{}", path, meta.len(), limit));
    }

    let bytes = std::fs::read(&expanded).map_err(|e| format!("file_read_base64_failed:{path}: {e}"))?;
    let encoded = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}
