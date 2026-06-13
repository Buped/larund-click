//! Deterministic spreadsheet / tabular file I/O.
//!
//! This is the "write into it and save, with no GUI typing" half of the OpenClaw-style
//! precision goal. Instead of opening Calc/Excel and typing into cells (slow, fragile,
//! depends on focus and timing), the agent reads and writes the file directly.
//!
//! Engine (all pure Rust, no Office process required):
//!   * read  — `calamine` for xlsx/xlsm/xls/ods, the `csv` crate for csv.
//!   * write — `umya_spreadsheet` for xlsx (creates new OR edits an existing file in
//!             place, then saves), the `csv` crate for csv.
//!
//! Writing `.xls`/`.ods` is intentionally unsupported — the agent should save as
//! `.xlsx` (which both LibreOffice Calc and Excel open natively) or `.csv`.

use serde::Deserialize;
use std::path::Path;

/// One explicit cell edit, e.g. `{ "ref": "B2", "value": "42" }`.
#[derive(Debug, Clone, Deserialize)]
pub struct CellEdit {
    pub r#ref: String,
    pub value: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Format {
    Xlsx,
    Csv,
    /// Readable (calamine) but not writable here.
    ReadOnly,
}

fn detect_format(path: &str) -> Format {
    match path.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "csv" | "tsv" | "txt" => Format::Csv,
        "xlsx" | "xlsm" => Format::Xlsx,
        "xls" | "ods" => Format::ReadOnly,
        _ => Format::Xlsx,
    }
}

/// Parse an A1-style reference into a 1-based `(column, row)` pair.
fn parse_cell_ref(reference: &str) -> Option<(u32, u32)> {
    let trimmed = reference.trim();
    let split = trimmed.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = trimmed.split_at(split);
    if letters.is_empty() || digits.is_empty() {
        return None;
    }
    let mut col: u32 = 0;
    for ch in letters.chars() {
        if !ch.is_ascii_alphabetic() {
            return None;
        }
        col = col * 26 + (ch.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
    }
    let row: u32 = digits.parse().ok()?;
    if col == 0 || row == 0 {
        None
    } else {
        Some((col, row))
    }
}

// ─── Read ───────────────────────────────────────────────────────────────────────

pub fn read(path: &str, sheet: Option<String>, max_rows: Option<usize>) -> Result<String, String> {
    if !Path::new(path).exists() {
        return Err(format!("file_not_found: {path}"));
    }

    let (sheet_name, mut rows, total_rows) = match detect_format(path) {
        Format::Csv => read_csv(path, max_rows)?,
        _ => read_workbook(path, sheet, max_rows)?,
    };

    let truncated = max_rows.is_some_and(|m| total_rows > m);
    if let Some(m) = max_rows {
        rows.truncate(m);
    }
    let col_count = rows.iter().map(|r| r.len()).max().unwrap_or(0);

    serde_json::to_string(&serde_json::json!({
        "path": path,
        "sheet": sheet_name,
        "rows": rows,
        "row_count": rows.len(),
        "col_count": col_count,
        "total_rows": total_rows,
        "truncated": truncated,
    }))
    .map_err(|e| e.to_string())
}

fn read_csv(path: &str, max_rows: Option<usize>) -> Result<(String, Vec<Vec<String>>, usize), String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_path(path)
        .map_err(|e| format!("Failed to open csv {path}: {e}"))?;

    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut total = 0usize;
    for record in reader.records() {
        let record = record.map_err(|e| format!("Failed to read csv row: {e}"))?;
        total += 1;
        if max_rows.is_none_or(|m| rows.len() < m) {
            rows.push(record.iter().map(|s| s.to_string()).collect());
        }
    }
    Ok(("csv".to_string(), rows, total))
}

fn read_workbook(
    path: &str,
    sheet: Option<String>,
    max_rows: Option<usize>,
) -> Result<(String, Vec<Vec<String>>, usize), String> {
    use calamine::Reader;

    let mut workbook = calamine::open_workbook_auto(path)
        .map_err(|e| format!("Failed to open spreadsheet {path}: {e}"))?;

    let names = workbook.sheet_names().to_vec();
    let target = match sheet {
        Some(s) if names.iter().any(|n| n.eq_ignore_ascii_case(&s)) => names
            .iter()
            .find(|n| n.eq_ignore_ascii_case(&s))
            .cloned()
            .unwrap_or(s),
        Some(s) => return Err(format!("sheet_not_found: '{s}'. Available: {}", names.join(", "))),
        None => names
            .first()
            .cloned()
            .ok_or_else(|| "no_sheets: the workbook has no sheets".to_string())?,
    };

    let range = workbook
        .worksheet_range(&target)
        .map_err(|e| format!("Failed to read sheet '{target}': {e}"))?;

    let total = range.rows().count();
    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        if max_rows.is_some_and(|m| rows.len() >= m) {
            break;
        }
        rows.push(row.iter().map(|cell| cell.to_string()).collect());
    }
    Ok((target, rows, total))
}

// ─── Write ──────────────────────────────────────────────────────────────────────

pub fn write(
    path: &str,
    sheet: Option<String>,
    rows: Option<Vec<Vec<String>>>,
    cells: Option<Vec<CellEdit>>,
    start_cell: Option<String>,
    mode: Option<String>,
) -> Result<String, String> {
    if rows.is_none() && cells.is_none() {
        return Err("nothing_to_write: provide 'rows' (a 2D array) and/or 'cells' (a list of {ref,value}).".to_string());
    }
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
        }
    }

    match detect_format(path) {
        Format::Csv => write_csv(path, rows, cells, start_cell),
        Format::Xlsx => write_xlsx(path, sheet, rows, cells, start_cell, mode),
        Format::ReadOnly => Err(format!(
            "unsupported_write_format: cannot write '{path}'. Save as .xlsx (opens in LibreOffice Calc and Excel) or .csv instead."
        )),
    }
}

fn write_xlsx(
    path: &str,
    sheet: Option<String>,
    rows: Option<Vec<Vec<String>>>,
    cells: Option<Vec<CellEdit>>,
    start_cell: Option<String>,
    mode: Option<String>,
) -> Result<String, String> {
    let exists = Path::new(path).exists();
    let force_new = mode.as_deref() == Some("new");
    let editing = exists && !force_new;

    let mut book = if editing {
        umya_spreadsheet::reader::xlsx::read(Path::new(path))
            .map_err(|e| format!("Failed to open existing workbook {path}: {e:?}"))?
    } else {
        umya_spreadsheet::new_file()
    };

    // Resolve the target sheet: requested name, else the first existing sheet.
    let sheet_name = match sheet {
        Some(s) => s,
        None => book
            .sheet_collection()
            .first()
            .map(|s| s.name().to_string())
            .unwrap_or_else(|| "Sheet1".to_string()),
    };
    if book.sheet_by_name(&sheet_name).is_err() {
        book.new_sheet(&sheet_name)
            .map_err(|e| format!("Failed to add sheet '{sheet_name}': {e}"))?;
    }
    let worksheet = book
        .sheet_by_name_mut(&sheet_name)
        .map_err(|e| format!("sheet_missing: '{sheet_name}': {e}"))?;

    let mut written = 0usize;
    let (start_col, start_row) = start_cell
        .as_deref()
        .and_then(parse_cell_ref)
        .unwrap_or((1, 1));

    let row_count = rows.as_ref().map(|r| r.len()).unwrap_or(0);
    if let Some(rows) = rows {
        for (ri, row) in rows.iter().enumerate() {
            for (ci, value) in row.iter().enumerate() {
                let col = start_col + ci as u32;
                let r = start_row + ri as u32;
                worksheet.cell_mut((col, r)).set_value(value.clone());
                written += 1;
            }
        }
    }
    if let Some(cells) = cells {
        for cell in cells {
            let (col, r) = parse_cell_ref(&cell.r#ref)
                .ok_or_else(|| format!("bad_cell_ref: '{}'", cell.r#ref))?;
            worksheet.cell_mut((col, r)).set_value(cell.value.clone());
            written += 1;
        }
    }

    umya_spreadsheet::writer::xlsx::write(&book, Path::new(path))
        .map_err(|e| format!("Failed to save xlsx {path}: {e:?}"))?;

    serde_json::to_string(&serde_json::json!({
        "status": "saved",
        "path": path,
        "format": "xlsx",
        "sheet": sheet_name,
        "mode": if editing { "edit" } else { "new" },
        "written_cells": written,
        "written_rows": row_count,
        "message": format!("Wrote {written} cell(s) to sheet '{sheet_name}' and saved {path}."),
    }))
    .map_err(|e| e.to_string())
}

fn write_csv(
    path: &str,
    rows: Option<Vec<Vec<String>>>,
    cells: Option<Vec<CellEdit>>,
    start_cell: Option<String>,
) -> Result<String, String> {
    // Build a dense grid from rows (placed at start_cell) and/or explicit cells.
    let (start_col, start_row) = start_cell
        .as_deref()
        .and_then(parse_cell_ref)
        .unwrap_or((1, 1));

    let mut grid: Vec<Vec<String>> = Vec::new();
    let put = |col1: u32, row1: u32, value: String, grid: &mut Vec<Vec<String>>| {
        let r = (row1 - 1) as usize;
        let c = (col1 - 1) as usize;
        if grid.len() <= r {
            grid.resize(r + 1, Vec::new());
        }
        if grid[r].len() <= c {
            grid[r].resize(c + 1, String::new());
        }
        grid[r][c] = value;
    };

    let row_count = rows.as_ref().map(|r| r.len()).unwrap_or(0);
    if let Some(rows) = rows {
        for (ri, row) in rows.iter().enumerate() {
            for (ci, value) in row.iter().enumerate() {
                put(start_col + ci as u32, start_row + ri as u32, value.clone(), &mut grid);
            }
        }
    }
    if let Some(cells) = cells {
        for cell in cells {
            let (col, r) = parse_cell_ref(&cell.r#ref)
                .ok_or_else(|| format!("bad_cell_ref: '{}'", cell.r#ref))?;
            put(col, r, cell.value.clone(), &mut grid);
        }
    }

    let max_cols = grid.iter().map(|r| r.len()).max().unwrap_or(0);
    let mut writer = csv::WriterBuilder::new()
        .from_path(path)
        .map_err(|e| format!("Failed to create csv {path}: {e}"))?;
    let mut written = 0usize;
    for row in &grid {
        let mut padded = row.clone();
        padded.resize(max_cols, String::new());
        written += padded.iter().filter(|c| !c.is_empty()).count();
        writer
            .write_record(&padded)
            .map_err(|e| format!("Failed to write csv row: {e}"))?;
    }
    writer.flush().map_err(|e| format!("Failed to flush csv: {e}"))?;

    serde_json::to_string(&serde_json::json!({
        "status": "saved",
        "path": path,
        "format": "csv",
        "mode": "new",
        "written_cells": written,
        "written_rows": grid.len().max(row_count),
        "message": format!("Wrote {} row(s) to {path}.", grid.len()),
    }))
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> String {
        std::env::temp_dir()
            .join(format!("larund_sheets_test_{name}"))
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn cell_ref_parsing() {
        assert_eq!(parse_cell_ref("A1"), Some((1, 1)));
        assert_eq!(parse_cell_ref("B2"), Some((2, 2)));
        assert_eq!(parse_cell_ref("AA10"), Some((27, 10)));
        assert_eq!(parse_cell_ref("Z1"), Some((26, 1)));
        assert!(parse_cell_ref("1A").is_none());
        assert!(parse_cell_ref("").is_none());
    }

    #[test]
    fn xlsx_write_read_roundtrip() {
        let path = tmp("rt.xlsx");
        let _ = std::fs::remove_file(&path);

        write(
            &path,
            None,
            Some(vec![
                vec!["Name".into(), "Age".into()],
                vec!["Anna".into(), "30".into()],
                vec!["Béla".into(), "25".into()],
            ]),
            None,
            None,
            Some("new".into()),
        )
        .expect("write xlsx");

        // Edit a single cell in place on the existing file.
        write(
            &path,
            None,
            None,
            Some(vec![CellEdit { r#ref: "C1".into(), value: "Note".into() }]),
            None,
            Some("edit".into()),
        )
        .expect("edit xlsx");

        let read_json = read(&path, None, None).expect("read xlsx");
        assert!(read_json.contains("\"Anna\""), "rows: {read_json}");
        assert!(read_json.contains("\"Béla\""), "rows: {read_json}");
        assert!(read_json.contains("\"Note\""), "edited cell missing: {read_json}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn csv_write_read_roundtrip() {
        let path = tmp("rt.csv");
        let _ = std::fs::remove_file(&path);

        write(
            &path,
            None,
            Some(vec![
                vec!["a".into(), "b".into()],
                vec!["c".into(), "d,e".into()], // comma forces quoting
            ]),
            None,
            None,
            None,
        )
        .expect("write csv");

        let read_json = read(&path, None, None).expect("read csv");
        assert!(read_json.contains("\"d,e\""), "csv roundtrip: {read_json}");
        let _ = std::fs::remove_file(&path);
    }
}
