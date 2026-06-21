use crate::artifacts::pdf::model_lines;
use serde_json::Value;
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

fn write_entry(zip: &mut ZipWriter<Cursor<Vec<u8>>>, name: &str, content: &str) -> Result<(), String> {
    zip.start_file(name, FileOptions::default()).map_err(|e| format!("docx_entry_failed:{name}: {e}"))?;
    zip.write_all(content.as_bytes()).map_err(|e| format!("docx_write_entry_failed:{name}: {e}"))
}

pub fn write_docx(path: &Path, model: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("docx_mkdir_failed: {e}"))?;
    }
    let title = model.get("title").and_then(Value::as_str).unwrap_or("Artifact");
    let mut body = String::new();
    body.push_str(&format!(
        "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>",
        escape_xml(title)
    ));
    for line in model_lines(model).into_iter().skip(1) {
        if line == "\u{000C}" {
            body.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
        } else if !line.trim().is_empty() {
            body.push_str(&format!(
                "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                escape_xml(&line)
            ));
        }
    }
    if let Some(tables) = model.get("tables").and_then(Value::as_array) {
        for table in tables {
            body.push_str("<w:tbl><w:tblPr><w:tblW w:w=\"5000\" w:type=\"pct\"/></w:tblPr>");
            if let Some(cols) = table.get("columns").and_then(Value::as_array) {
                body.push_str("<w:tr>");
                for col in cols {
                    body.push_str(&format!("<w:tc><w:p><w:r><w:b/><w:t>{}</w:t></w:r></w:p></w:tc>", escape_xml(col.as_str().unwrap_or(""))));
                }
                body.push_str("</w:tr>");
            }
            if let Some(rows) = table.get("rows").and_then(Value::as_array) {
                for row in rows {
                    body.push_str("<w:tr>");
                    for cell in row.as_array().into_iter().flatten() {
                        body.push_str(&format!("<w:tc><w:p><w:r><w:t>{}</w:t></w:r></w:p></w:tc>", escape_xml(cell.as_str().unwrap_or(""))));
                    }
                    body.push_str("</w:tr>");
                }
            }
            body.push_str("</w:tbl>");
        }
    }
    let doc_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>{}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
</w:document>"#,
        body
    );
    let mut zip = ZipWriter::new(Cursor::new(Vec::<u8>::new()));
    write_entry(&mut zip, "[Content_Types].xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"#)?;
    write_entry(&mut zip, "_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#)?;
    write_entry(&mut zip, "word/_rels/document.xml.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#)?;
    write_entry(&mut zip, "word/styles.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
</w:styles>"#)?;
    write_entry(&mut zip, "word/document.xml", &doc_xml)?;
    let bytes = zip.finish().map_err(|e| format!("docx_finish_failed: {e}"))?.into_inner();
    std::fs::write(path, bytes).map_err(|e| format!("docx_save_failed:{}: {e}", path.display()))
}
