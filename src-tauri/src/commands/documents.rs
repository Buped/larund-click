use std::io::{Cursor, Read, Write};
use std::path::Path;
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

fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
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
