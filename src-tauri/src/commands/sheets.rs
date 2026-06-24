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
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
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
                set_typed_value(worksheet.cell_mut((col, r)), value);
                written += 1;
            }
        }
    }
    if let Some(cells) = cells {
        for cell in cells {
            let (col, r) = parse_cell_ref(&cell.r#ref)
                .ok_or_else(|| format!("bad_cell_ref: '{}'", cell.r#ref))?;
            set_typed_value(worksheet.cell_mut((col, r)), &cell.value);
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

// ─── Analytics: profile + query (Part C — large-data handling) ────────────────────
//
// `read` returns raw rows and is meant for small files. For large tables we never
// dump the raw data into the caller's (AI) context. Instead:
//   * `profile` streams the whole file natively and returns per-column statistics
//     plus a small representative sample.
//   * `query`   streams the whole file natively and returns only the *result* of a
//     filter / aggregate / group-by — not the rows.
//
// CSV is processed in true streaming fashion (row-by-row, constant memory). XLSX is
// read via `calamine`, which materializes the sheet range in memory (a calamine
// limitation), but we still iterate it row-by-row and only keep small accumulators
// — we never build a full JSON copy of the data.

/// A normalized scalar cell value used by the profiling/query engines.
struct Val {
    text: String,
    num: Option<f64>,
    is_date: bool,
}

impl Val {
    fn empty() -> Self {
        Val { text: String::new(), num: None, is_date: false }
    }
    fn is_empty(&self) -> bool {
        self.text.trim().is_empty() && self.num.is_none()
    }
    /// "empty" | "number" | "date" | "text"
    fn kind(&self) -> &'static str {
        if self.is_empty() {
            "empty"
        } else if self.is_date {
            "date"
        } else if self.num.is_some() {
            "number"
        } else {
            "text"
        }
    }
}

fn fmt_num(f: f64) -> String {
    if f.is_finite() && f == f.trunc() && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    }
}

/// Best-effort, locale-tolerant numeric parse. Handles `1,234.56` (en),
/// `1 234,56` / `1.234,56` (hu/de), currency symbols, `%`, and parenthesised
/// negatives. Returns `None` when the string is not clearly a number.
fn parse_number(raw: &str) -> Option<f64> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let mut t: String = s
        .chars()
        .filter(|c| !matches!(c, ' ' | '\u{00A0}' | '\u{202F}' | '\u{2009}'))
        .collect();
    for sym in ["HUF", "Ft", "ft", "USD", "EUR", "$", "€", "£", "%"] {
        t = t.replace(sym, "");
    }
    let t = t.trim();
    if t.is_empty() {
        return None;
    }
    let (neg, body) = if t.starts_with('(') && t.ends_with(')') {
        (true, &t[1..t.len() - 1])
    } else if let Some(rest) = t.strip_prefix('-') {
        (true, rest)
    } else if let Some(rest) = t.strip_prefix('+') {
        (false, rest)
    } else {
        (false, t)
    };
    if body.is_empty() || !body.chars().all(|c| c.is_ascii_digit() || c == ',' || c == '.') {
        return None;
    }
    let has_comma = body.contains(',');
    let has_dot = body.contains('.');
    let normalized = if has_comma && has_dot {
        // The rightmost separator is the decimal point.
        if body.rfind(',') > body.rfind('.') {
            body.replace('.', "").replace(',', ".")
        } else {
            body.replace(',', "")
        }
    } else if has_comma {
        let parts: Vec<&str> = body.split(',').collect();
        if parts.len() == 2 && parts[1].len() != 3 {
            body.replace(',', ".") // "12,5" → decimal
        } else {
            body.replace(',', "") // "1,234" / "1,234,567" → thousands
        }
    } else {
        body.to_string()
    };
    let v: f64 = normalized.parse().ok()?;
    Some(if neg { -v } else { v })
}

/// Heuristic date detection for string cells (ISO, `/`, `.`-separated European).
fn looks_like_date(s: &str) -> bool {
    let t = s.trim();
    if t.len() < 6 || t.len() > 32 {
        return false;
    }
    if !t
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '-' | '/' | '.' | ':' | ' ' | 'T' | 'Z' | '+'))
    {
        return false;
    }
    if t.chars().filter(|c| c.is_ascii_digit()).count() < 4 {
        return false;
    }
    let strong = t.contains('-') || t.contains('/') || t.contains(':');
    let dotted = t.matches('.').count() == 2
        && t.split(['.', ' ', 'T'])
            .any(|p| p.len() == 4 && p.chars().all(|c| c.is_ascii_digit()));
    strong || dotted
}

fn str_to_val(s: &str) -> Val {
    if s.trim().is_empty() {
        return Val::empty();
    }
    if looks_like_date(s) {
        return Val { text: s.to_string(), num: None, is_date: true };
    }
    Val { num: parse_number(s), text: s.to_string(), is_date: false }
}

fn data_to_val(d: &calamine::Data) -> Val {
    use calamine::Data;
    match d {
        Data::Empty => Val::empty(),
        Data::Int(i) => Val { text: i.to_string(), num: Some(*i as f64), is_date: false },
        Data::Float(f) => Val { text: fmt_num(*f), num: Some(*f), is_date: false },
        Data::Bool(b) => Val { text: b.to_string(), num: None, is_date: false },
        Data::String(s) => str_to_val(s),
        Data::DateTime(_) => Val { text: d.to_string(), num: None, is_date: true },
        Data::DateTimeIso(s) => Val { text: s.clone(), num: None, is_date: true },
        Data::DurationIso(s) => Val { text: s.clone(), num: None, is_date: false },
        Data::Error(_) => Val { text: format!("{d}"), num: None, is_date: false },
    }
}

fn resolve_sheet(names: &[String], sheet: Option<&str>) -> Result<String, String> {
    match sheet {
        Some(s) if names.iter().any(|n| n.eq_ignore_ascii_case(s)) => Ok(names
            .iter()
            .find(|n| n.eq_ignore_ascii_case(s))
            .cloned()
            .unwrap_or_else(|| s.to_string())),
        Some(s) => Err(format!("sheet_not_found: '{s}'. Available: {}", names.join(", "))),
        None => names
            .first()
            .cloned()
            .ok_or_else(|| "no_sheets: the workbook has no sheets".to_string()),
    }
}

/// Iterate a tabular file row-by-row. Row 0 is the header (passed to `on_header`);
/// every subsequent row is passed to `on_row(row_index, &[Val])`. Returns
/// `(sheet_name, header, data_row_count)`.
fn for_each_row<H, F>(
    path: &str,
    sheet: Option<&str>,
    mut on_header: H,
    mut on_row: F,
) -> Result<(String, Vec<String>, usize), String>
where
    H: FnMut(&[String]),
    F: FnMut(usize, &[Val]),
{
    match detect_format(path) {
        Format::Csv => {
            let mut reader = csv::ReaderBuilder::new()
                .has_headers(false)
                .flexible(true)
                .from_path(path)
                .map_err(|e| format!("Failed to open csv {path}: {e}"))?;
            let mut header: Vec<String> = Vec::new();
            let mut data_rows = 0usize;
            for (idx, record) in reader.records().enumerate() {
                let record = record.map_err(|e| format!("Failed to read csv row: {e}"))?;
                if idx == 0 {
                    header = record.iter().map(|s| s.to_string()).collect();
                    on_header(&header);
                } else {
                    let vals: Vec<Val> = record.iter().map(str_to_val).collect();
                    on_row(idx, &vals);
                    data_rows += 1;
                }
            }
            Ok(("csv".to_string(), header, data_rows))
        }
        _ => {
            use calamine::Reader;
            let mut workbook = calamine::open_workbook_auto(path)
                .map_err(|e| format!("Failed to open spreadsheet {path}: {e}"))?;
            let names = workbook.sheet_names().to_vec();
            let target = resolve_sheet(&names, sheet)?;
            let range = workbook
                .worksheet_range(&target)
                .map_err(|e| format!("Failed to read sheet '{target}': {e}"))?;
            let mut header: Vec<String> = Vec::new();
            let mut data_rows = 0usize;
            for (idx, row) in range.rows().enumerate() {
                if idx == 0 {
                    header = row.iter().map(|c| c.to_string()).collect();
                    on_header(&header);
                } else {
                    let vals: Vec<Val> = row.iter().map(data_to_val).collect();
                    on_row(idx, &vals);
                    data_rows += 1;
                }
            }
            Ok((target, header, data_rows))
        }
    }
}

fn round6(f: f64) -> f64 {
    if !f.is_finite() {
        return 0.0;
    }
    (f * 1_000_000.0).round() / 1_000_000.0
}

fn numj(f: f64) -> serde_json::Value {
    serde_json::Number::from_f64(round6(f))
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::Null)
}

// ── profile ───────────────────────────────────────────────────────────────────

const UNIQUE_CAP: usize = 50_000;
const FREQ_CAP: usize = 20_000;

#[derive(Default)]
struct ColAcc {
    non_null: usize,
    nulls: usize,
    numbers: usize,
    dates: usize,
    texts: usize,
    sum: f64,
    min: f64,
    max: f64,
    has_num: bool,
    uniques: HashSet<String>,
    unique_capped: bool,
    freq: HashMap<String, usize>,
    freq_capped: bool,
}

impl ColAcc {
    fn observe(&mut self, v: &Val) {
        if v.is_empty() {
            self.nulls += 1;
            return;
        }
        self.non_null += 1;
        match v.kind() {
            "number" => {
                self.numbers += 1;
                if let Some(n) = v.num {
                    if !self.has_num {
                        self.min = n;
                        self.max = n;
                        self.has_num = true;
                    } else {
                        if n < self.min {
                            self.min = n;
                        }
                        if n > self.max {
                            self.max = n;
                        }
                    }
                    self.sum += n;
                }
            }
            "date" => self.dates += 1,
            _ => self.texts += 1,
        }
        if !self.unique_capped {
            if self.uniques.len() < UNIQUE_CAP {
                self.uniques.insert(v.text.clone());
            } else {
                self.unique_capped = true;
            }
        }
        if v.num.is_none() && !v.is_date && !self.freq_capped {
            if self.freq.len() < FREQ_CAP || self.freq.contains_key(&v.text) {
                *self.freq.entry(v.text.clone()).or_insert(0) += 1;
            } else {
                self.freq_capped = true;
            }
        }
    }

    fn dominant_type(&self) -> &'static str {
        if self.non_null == 0 {
            return "empty";
        }
        if self.numbers >= self.texts && self.numbers >= self.dates && self.numbers > 0 {
            "number"
        } else if self.dates >= self.texts && self.dates > 0 {
            "date"
        } else {
            "text"
        }
    }
}

/// Deterministic reservoir sampler (xorshift RNG) for representative sample rows.
struct Reservoir {
    cap: usize,
    seen: usize,
    items: Vec<(usize, Vec<String>)>,
    rng: u64,
}

impl Reservoir {
    fn new(cap: usize) -> Self {
        Reservoir { cap, seen: 0, items: Vec::new(), rng: 0x9E37_79B9_7F4A_7C15 }
    }
    fn next_rand(&mut self) -> u64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        self.rng
    }
    fn offer(&mut self, idx: usize, row: &[Val]) {
        if self.cap == 0 {
            return;
        }
        self.seen += 1;
        if self.items.len() < self.cap {
            self.items.push((idx, row.iter().map(|v| v.text.clone()).collect()));
        } else {
            let j = (self.next_rand() % (self.seen as u64)) as usize;
            if j < self.cap {
                self.items[j] = (idx, row.iter().map(|v| v.text.clone()).collect());
            }
        }
    }
}

pub fn profile(path: &str, sheet: Option<String>, sample_size: Option<usize>) -> Result<String, String> {
    if !Path::new(path).exists() {
        return Err(format!("file_not_found: {path}"));
    }
    let head_n = sample_size.unwrap_or(10).clamp(1, 50);
    let mut cols: Vec<ColAcc> = Vec::new();
    let mut head_rows: Vec<Vec<String>> = Vec::new();
    let mut reservoir = Reservoir::new(head_n);

    let (sheet_name, header, data_rows) = for_each_row(
        path,
        sheet.as_deref(),
        |_hdr| {},
        |idx, row| {
            if row.len() > cols.len() {
                cols.resize_with(row.len(), ColAcc::default);
            }
            for (i, v) in row.iter().enumerate() {
                cols[i].observe(v);
            }
            if head_rows.len() < head_n {
                head_rows.push(row.iter().map(|v| v.text.clone()).collect());
            } else {
                reservoir.offer(idx, row);
            }
        },
    )?;

    let col_count = header.len().max(cols.len());
    let total = data_rows;
    let mut columns = Vec::with_capacity(col_count);
    for i in 0..col_count {
        let name = header.get(i).cloned().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| format!("col{}", i + 1));
        let acc = cols.get(i);
        let (non_null, nulls) = acc.map(|a| (a.non_null, a.nulls)).unwrap_or((0, total));
        let denom = (non_null + nulls).max(1);
        let null_ratio = round6(nulls as f64 / denom as f64);
        let dtype = acc.map(|a| a.dominant_type()).unwrap_or("empty");
        let unique = match acc {
            Some(a) if a.unique_capped => serde_json::json!(format!(">={UNIQUE_CAP}")),
            Some(a) => serde_json::json!(a.uniques.len()),
            None => serde_json::json!(0),
        };
        let mut obj = serde_json::json!({
            "name": name,
            "index": i,
            "type": dtype,
            "non_null": non_null,
            "nulls": nulls,
            "null_ratio": null_ratio,
            "unique": unique,
        });
        if let Some(a) = acc {
            if a.has_num && a.numbers > 0 {
                let mean = a.sum / a.numbers as f64;
                obj["min"] = numj(a.min);
                obj["max"] = numj(a.max);
                obj["mean"] = numj(mean);
                obj["sum"] = numj(a.sum);
            }
            if dtype == "text" && !a.freq.is_empty() {
                let mut pairs: Vec<(&String, &usize)> = a.freq.iter().collect();
                pairs.sort_by(|x, y| y.1.cmp(x.1).then_with(|| x.0.cmp(y.0)));
                let top: Vec<serde_json::Value> = pairs
                    .into_iter()
                    .take(5)
                    .map(|(value, count)| serde_json::json!({ "value": value, "count": count }))
                    .collect();
                obj["top_values"] = serde_json::json!(top);
            }
        }
        columns.push(obj);
    }

    reservoir.items.sort_by_key(|(idx, _)| *idx);
    let distributed: Vec<Vec<String>> = reservoir.items.into_iter().map(|(_, r)| r).collect();

    serde_json::to_string(&serde_json::json!({
        "path": path,
        "sheet": sheet_name,
        "row_count": data_rows,
        "col_count": col_count,
        "columns": columns,
        "sample": {
            "header": header,
            "head": head_rows,
            "distributed": distributed,
        },
        "note": "Profiled the full dataset natively (streaming); raw rows were NOT loaded into the caller context. Use sheet.query for exact aggregates, or sheet.read for a small raw subset.",
    }))
    .map_err(|e| e.to_string())
}

// ── query ─────────────────────────────────────────────────────────────────────

const DISTINCT_CAP: usize = 200_000;

#[derive(Debug, Clone, Deserialize)]
pub struct Condition {
    pub column: String,
    pub op: String,
    #[serde(default)]
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    #[serde(default = "default_match", rename = "match")]
    pub match_mode: String,
    #[serde(default)]
    pub conditions: Vec<Condition>,
}

fn default_match() -> String {
    "all".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct AggSpec {
    pub op: String,
    #[serde(default)]
    pub column: Option<String>,
    #[serde(default, rename = "as")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct QueryArgs {
    #[serde(default)]
    pub filter: Option<Filter>,
    #[serde(default)]
    pub columns: Option<Vec<String>>,
    #[serde(default)]
    pub aggregate: Option<Vec<AggSpec>>,
    #[serde(default)]
    pub group_by: Option<Vec<String>>,
    #[serde(default)]
    pub limit: Option<usize>,
}

struct ResolvedAgg {
    op: String,
    col: Option<usize>,
    label: String,
}

struct AggAcc {
    count: usize,     // non-null values in the agg column
    num_count: usize, // numeric values (for avg)
    sum: f64,
    min: f64,
    max: f64,
    has: bool,
    distinct: HashSet<String>,
    distinct_capped: bool,
}

impl AggAcc {
    fn new() -> Self {
        AggAcc {
            count: 0,
            num_count: 0,
            sum: 0.0,
            min: 0.0,
            max: 0.0,
            has: false,
            distinct: HashSet::new(),
            distinct_capped: false,
        }
    }
    fn update(&mut self, v: &Val) {
        if v.is_empty() {
            return;
        }
        self.count += 1;
        if let Some(n) = v.num {
            self.num_count += 1;
            if !self.has {
                self.min = n;
                self.max = n;
                self.has = true;
            } else {
                if n < self.min {
                    self.min = n;
                }
                if n > self.max {
                    self.max = n;
                }
            }
            self.sum += n;
        }
        if !self.distinct_capped {
            if self.distinct.len() < DISTINCT_CAP {
                self.distinct.insert(v.text.clone());
            } else {
                self.distinct_capped = true;
            }
        }
    }
}

struct GroupAgg {
    rows: usize,
    accs: Vec<AggAcc>,
}

struct QueryState {
    args: QueryArgs,
    col_idx: HashMap<String, usize>,
    header: Vec<String>,
    resolved_aggs: Vec<ResolvedAgg>,
    group_cols: Vec<usize>,
    proj_cols: Option<Vec<usize>>,
    groups: HashMap<Vec<String>, GroupAgg>,
    matched: usize,
    proj_rows: Vec<Vec<String>>,
    limit: usize,
    is_aggregate: bool,
}

fn norm_name(s: &str) -> String {
    s.trim().to_lowercase()
}

fn json_str(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn json_num(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => parse_number(s),
        _ => None,
    }
}

fn cell_eq(v: &Val, target: &serde_json::Value) -> bool {
    if let (Some(a), Some(b)) = (v.num, json_num(target)) {
        (a - b).abs() < 1e-9
    } else {
        v.text.trim().eq_ignore_ascii_case(json_str(target).trim())
    }
}

impl QueryState {
    fn new(args: QueryArgs) -> Self {
        let is_aggregate = args.aggregate.is_some();
        let limit = args.limit.unwrap_or(100).clamp(1, 5000);
        QueryState {
            args,
            col_idx: HashMap::new(),
            header: Vec::new(),
            resolved_aggs: Vec::new(),
            group_cols: Vec::new(),
            proj_cols: None,
            groups: HashMap::new(),
            matched: 0,
            proj_rows: Vec::new(),
            limit,
            is_aggregate,
        }
    }

    fn set_header(&mut self, header: &[String]) {
        self.header = header.to_vec();
        for (i, h) in header.iter().enumerate() {
            self.col_idx.entry(norm_name(h)).or_insert(i);
            // also allow A1-style letter references
            self.col_idx.entry(col_letter(i)).or_insert(i);
        }
        // Resolve aggregate specs.
        if let Some(aggs) = &self.args.aggregate {
            for a in aggs {
                let col = a.column.as_deref().and_then(|c| self.col_idx.get(&norm_name(c)).copied());
                let label = a.label.clone().unwrap_or_else(|| match &a.column {
                    Some(c) => format!("{}_{}", a.op.to_lowercase(), c),
                    None => a.op.to_lowercase(),
                });
                self.resolved_aggs.push(ResolvedAgg { op: a.op.to_lowercase(), col, label });
            }
        }
        if self.is_aggregate && self.resolved_aggs.is_empty() {
            self.resolved_aggs.push(ResolvedAgg { op: "count".into(), col: None, label: "count".into() });
        }
        // Resolve group-by columns.
        if let Some(gb) = &self.args.group_by {
            self.group_cols = gb.iter().filter_map(|c| self.col_idx.get(&norm_name(c)).copied()).collect();
        }
        // Resolve projection columns.
        if let Some(cols) = &self.args.columns {
            self.proj_cols = Some(cols.iter().filter_map(|c| self.col_idx.get(&norm_name(c)).copied()).collect());
        }
    }

    fn passes_filter(&self, row: &[Val]) -> bool {
        let Some(f) = &self.args.filter else { return true };
        if f.conditions.is_empty() {
            return true;
        }
        let any = f.match_mode.eq_ignore_ascii_case("any");
        if any {
            f.conditions.iter().any(|c| self.eval_cond(c, row))
        } else {
            f.conditions.iter().all(|c| self.eval_cond(c, row))
        }
    }

    fn eval_cond(&self, c: &Condition, row: &[Val]) -> bool {
        let Some(&i) = self.col_idx.get(&norm_name(&c.column)) else { return false };
        let Some(v) = row.get(i) else { return false };
        let target_num = json_num(&c.value);
        let num_cmp = |f: fn(f64, f64) -> bool| matches!((v.num, target_num), (Some(a), Some(b)) if f(a, b));
        match c.op.to_lowercase().as_str() {
            "eq" | "=" | "==" => cell_eq(v, &c.value),
            "ne" | "neq" | "!=" | "<>" => !cell_eq(v, &c.value),
            "gt" | ">" => num_cmp(|a, b| a > b),
            "gte" | ">=" => num_cmp(|a, b| a >= b),
            "lt" | "<" => num_cmp(|a, b| a < b),
            "lte" | "<=" => num_cmp(|a, b| a <= b),
            "contains" => v.text.to_lowercase().contains(&json_str(&c.value).to_lowercase()),
            "not_contains" => !v.text.to_lowercase().contains(&json_str(&c.value).to_lowercase()),
            "starts_with" => v.text.to_lowercase().starts_with(&json_str(&c.value).to_lowercase()),
            "ends_with" => v.text.to_lowercase().ends_with(&json_str(&c.value).to_lowercase()),
            "in" => match &c.value {
                serde_json::Value::Array(arr) => arr.iter().any(|x| cell_eq(v, x)),
                _ => false,
            },
            "empty" => v.is_empty(),
            "not_empty" => !v.is_empty(),
            _ => false,
        }
    }

    fn observe(&mut self, _idx: usize, row: &[Val]) {
        if !self.passes_filter(row) {
            return;
        }
        self.matched += 1;
        if self.is_aggregate {
            let key: Vec<String> = self
                .group_cols
                .iter()
                .map(|&gi| row.get(gi).map(|v| v.text.trim().to_string()).unwrap_or_default())
                .collect();
            let n_aggs = self.resolved_aggs.len();
            let entry = self
                .groups
                .entry(key)
                .or_insert_with(|| GroupAgg { rows: 0, accs: (0..n_aggs).map(|_| AggAcc::new()).collect() });
            entry.rows += 1;
            for (ai, agg) in self.resolved_aggs.iter().enumerate() {
                if let Some(ci) = agg.col {
                    if let Some(v) = row.get(ci) {
                        entry.accs[ai].update(v);
                    }
                }
            }
        } else if self.proj_rows.len() < self.limit {
            let projected: Vec<String> = match &self.proj_cols {
                Some(cols) => cols.iter().map(|&ci| row.get(ci).map(|v| v.text.clone()).unwrap_or_default()).collect(),
                None => row.iter().map(|v| v.text.clone()).collect(),
            };
            self.proj_rows.push(projected);
        }
    }

    fn agg_value(&self, agg: &ResolvedAgg, acc: &AggAcc, rows: usize) -> serde_json::Value {
        match agg.op.as_str() {
            "sum" => numj(acc.sum),
            "avg" | "mean" | "average" => {
                if acc.num_count > 0 {
                    numj(acc.sum / acc.num_count as f64)
                } else {
                    serde_json::Value::Null
                }
            }
            "count" => match agg.col {
                Some(_) => serde_json::json!(acc.count),
                None => serde_json::json!(rows),
            },
            "min" => {
                if acc.has {
                    numj(acc.min)
                } else {
                    serde_json::Value::Null
                }
            }
            "max" => {
                if acc.has {
                    numj(acc.max)
                } else {
                    serde_json::Value::Null
                }
            }
            "count_distinct" | "distinct" | "nunique" => {
                if acc.distinct_capped {
                    serde_json::json!(format!(">={DISTINCT_CAP}"))
                } else {
                    serde_json::json!(acc.distinct.len())
                }
            }
            _ => serde_json::Value::Null,
        }
    }

    fn build_aggregates(&self, ga: &GroupAgg) -> serde_json::Map<String, serde_json::Value> {
        let mut map = serde_json::Map::new();
        for (ai, agg) in self.resolved_aggs.iter().enumerate() {
            map.insert(agg.label.clone(), self.agg_value(agg, &ga.accs[ai], ga.rows));
        }
        map
    }

    fn finish(self, path: &str, sheet_name: &str, total_rows: usize) -> serde_json::Value {
        if self.is_aggregate {
            let grouped = !self.group_cols.is_empty();
            if grouped {
                let group_names: Vec<String> =
                    self.group_cols.iter().map(|&i| self.header.get(i).cloned().unwrap_or_else(|| col_letter(i))).collect();
                let mut groups: Vec<(&Vec<String>, &GroupAgg)> = self.groups.iter().collect();
                groups.sort_by(|a, b| a.0.cmp(b.0));
                let limit = self.args.limit.unwrap_or(usize::MAX);
                let group_count = groups.len();
                let out: Vec<serde_json::Value> = groups
                    .into_iter()
                    .take(limit)
                    .map(|(key, ga)| {
                        let key_obj: serde_json::Map<String, serde_json::Value> = group_names
                            .iter()
                            .cloned()
                            .zip(key.iter().map(|s| serde_json::Value::String(s.clone())))
                            .collect();
                        serde_json::json!({
                            "key": key_obj,
                            "matched_rows": ga.rows,
                            "aggregates": self.build_aggregates(ga),
                        })
                    })
                    .collect();
                serde_json::json!({
                    "path": path,
                    "sheet": sheet_name,
                    "total_rows": total_rows,
                    "matched_rows": self.matched,
                    "group_by": group_names,
                    "group_count": group_count,
                    "groups": out,
                })
            } else {
                let empty = GroupAgg { rows: self.matched, accs: self.resolved_aggs.iter().map(|_| AggAcc::new()).collect() };
                let ga = self.groups.get(&Vec::<String>::new()).unwrap_or(&empty);
                serde_json::json!({
                    "path": path,
                    "sheet": sheet_name,
                    "total_rows": total_rows,
                    "matched_rows": self.matched,
                    "aggregates": self.build_aggregates(ga),
                })
            }
        } else {
            let columns: Vec<String> = match &self.proj_cols {
                Some(cols) => cols.iter().map(|&i| self.header.get(i).cloned().unwrap_or_else(|| col_letter(i))).collect(),
                None => self.header.clone(),
            };
            serde_json::json!({
                "path": path,
                "sheet": sheet_name,
                "total_rows": total_rows,
                "matched_rows": self.matched,
                "returned": self.proj_rows.len(),
                "columns": columns,
                "rows": self.proj_rows,
            })
        }
    }
}

/// Convert a 0-based column index into an A1-style letter ("A", "B", ... "AA").
fn col_letter(mut i: usize) -> String {
    let mut s = String::new();
    i += 1;
    while i > 0 {
        let rem = (i - 1) % 26;
        s.insert(0, (b'A' + rem as u8) as char);
        i = (i - 1) / 26;
    }
    s.to_lowercase()
}

pub fn query(path: &str, sheet: Option<String>, args: QueryArgs) -> Result<String, String> {
    if !Path::new(path).exists() {
        return Err(format!("file_not_found: {path}"));
    }
    let state = RefCell::new(QueryState::new(args));
    let (sheet_name, _header, data_rows) = for_each_row(
        path,
        sheet.as_deref(),
        |hdr| state.borrow_mut().set_header(hdr),
        |idx, row| state.borrow_mut().observe(idx, row),
    )?;
    let result = state.into_inner().finish(path, &sheet_name, data_rows);
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

// ─── Typed writes + formatting + charts + tables (Part B) ─────────────────────────
//
// Native Excel features via `umya-spreadsheet`:
//   * type-aware cell writes (numbers, formulas, booleans, ISO dates) so SUM/AVERAGE
//     and number formats work natively,
//   * a dedicated `format_range` op (fill, font, border, number format, column width,
//     freeze panes, and value-threshold conditional fills),
//   * native chart insertion (bar/line/pie/...),
//   * native Excel Tables (ListObject) for instant filter/sort.

/// Write a string into a cell as the right Excel type: a leading `=` becomes a
/// formula, parseable numbers become numbers (so SUM works), ISO dates become real
/// date cells, true/false become booleans, everything else stays text. Leading-zero
/// strings (e.g. "007") are kept as text to preserve IDs.
fn set_typed_value(cell: &mut umya_spreadsheet::Cell, raw: &str) {
    let trimmed = raw.trim();
    if let Some(formula) = trimmed.strip_prefix('=') {
        if !formula.is_empty() {
            cell.set_formula(formula);
            return;
        }
    }
    if trimmed.is_empty() {
        cell.set_value_string(raw.to_string());
        return;
    }
    match trimmed.to_lowercase().as_str() {
        "true" => {
            cell.set_value_bool(true);
            return;
        }
        "false" => {
            cell.set_value_bool(false);
            return;
        }
        _ => {}
    }
    // Preserve leading-zero identifiers and phone-like strings as text.
    let zero_padded = trimmed.len() > 1 && trimmed.starts_with('0') && !trimmed.starts_with("0.") && !trimmed.starts_with("0,");
    if !zero_padded {
        if let Some(serial) = excel_date_serial(trimmed) {
            cell.set_value_number(serial);
            cell.get_style_mut().get_number_format_mut().set_format_code("yyyy-mm-dd");
            return;
        }
        if let Some(n) = parse_number(trimmed) {
            cell.set_value_number(n);
            return;
        }
    }
    cell.set_value_string(raw.to_string());
}

/// Convert an ISO `YYYY-MM-DD` (optionally `YYYY/MM/DD`) date to an Excel serial
/// number (days since the 1900 date system epoch). Returns None for other formats.
fn excel_date_serial(s: &str) -> Option<f64> {
    let t = s.trim();
    let parts: Vec<&str> = if t.contains('-') {
        t.split('-').collect()
    } else if t.contains('/') {
        t.split('/').collect()
    } else {
        return None;
    };
    if parts.len() != 3 || parts[0].len() != 4 {
        return None;
    }
    let y: i64 = parts[0].parse().ok()?;
    let m: i64 = parts[1].parse().ok()?;
    let d: i64 = parts[2].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || !(1900..=9999).contains(&y) {
        return None;
    }
    // Days from 1899-12-30 (Excel's day 0, accounting for the 1900 leap-year bug).
    let days = days_from_civil(y, m, d) - days_from_civil(1899, 12, 30);
    if days < 1 {
        return None;
    }
    Some(days as f64)
}

/// Days since civil 1970-01-01 (Howard Hinnant's algorithm), used only for date diffs.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parse an A1 range like "A1:C10", a single cell "B2", or a whole column "A:A"
/// into 1-based `(c1, r1, c2, r2)`. Column-only ranges use rows 1..=1_048_576.
fn parse_range(range: &str) -> Option<(u32, u32, u32, u32)> {
    let trimmed = range.trim();
    if let Some((a, b)) = trimmed.split_once(':') {
        // Whole-column form "A:C"
        if a.chars().all(|c| c.is_ascii_alphabetic()) && b.chars().all(|c| c.is_ascii_alphabetic()) {
            let c1 = col_from_letters(a)?;
            let c2 = col_from_letters(b)?;
            return Some((c1.min(c2), 1, c1.max(c2), 1_048_576));
        }
        let (c1, r1) = parse_cell_ref(a)?;
        let (c2, r2) = parse_cell_ref(b)?;
        Some((c1.min(c2), r1.min(r2), c1.max(c2), r1.max(r2)))
    } else {
        let (c, r) = parse_cell_ref(trimmed)?;
        Some((c, r, c, r))
    }
}

fn col_from_letters(letters: &str) -> Option<u32> {
    let mut col = 0u32;
    for ch in letters.chars() {
        if !ch.is_ascii_alphabetic() {
            return None;
        }
        col = col * 26 + (ch.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
    }
    if col == 0 {
        None
    } else {
        Some(col)
    }
}

/// Normalize a CSS-ish hex color ("#RRGGBB", "RRGGBB", "AARRGGBB") to umya ARGB ("FFRRGGBB").
fn to_argb(hex: &str) -> String {
    let h = hex.trim().trim_start_matches('#').to_uppercase();
    match h.len() {
        6 => format!("FF{h}"),
        8 => h,
        _ => "FF000000".to_string(),
    }
}

/// Map a friendly alias OR a raw Excel format code to a number-format code.
fn number_format_code(spec: &str) -> String {
    match spec.trim().to_lowercase().as_str() {
        "currency_huf" | "huf" | "ft" => r#"#,##0" Ft""#.to_string(),
        "currency_eur" | "eur" => r#"#,##0.00" €""#.to_string(),
        "currency_usd" | "usd" => r##""$"#,##0.00"##.to_string(),
        "percent" | "percentage" => "0.00%".to_string(),
        "thousands" | "number" => "#,##0".to_string(),
        "decimal" => "#,##0.00".to_string(),
        "integer" => "0".to_string(),
        "date" => "yyyy-mm-dd".to_string(),
        "datetime" => "yyyy-mm-dd hh:mm".to_string(),
        other if !other.is_empty() => spec.to_string(), // treat as a raw format code
        _ => "General".to_string(),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConditionalSpec {
    pub op: String,
    pub value: f64,
    pub background: String,
    #[serde(default)]
    pub font_color: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct FormatArgs {
    pub range: String,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub font_color: Option<String>,
    #[serde(default)]
    pub bold: Option<bool>,
    #[serde(default)]
    pub italic: Option<bool>,
    #[serde(default)]
    pub font_size: Option<f64>,
    #[serde(default)]
    pub border: Option<bool>,
    #[serde(default)]
    pub number_format: Option<String>,
    #[serde(default)]
    pub column_width: Option<f64>,
    #[serde(default)]
    pub freeze_rows: Option<u32>,
    #[serde(default)]
    pub freeze_cols: Option<u32>,
    #[serde(default)]
    pub conditional: Option<ConditionalSpec>,
}

fn open_existing(path: &str) -> Result<umya_spreadsheet::Workbook, String> {
    if !Path::new(path).exists() {
        return Err(format!("file_not_found: {path}. Create it with sheet.write first."));
    }
    umya_spreadsheet::reader::xlsx::read(Path::new(path))
        .map_err(|e| format!("Failed to open workbook {path}: {e:?}"))
}

fn target_sheet_name(book: &umya_spreadsheet::Workbook, sheet: Option<String>) -> String {
    match sheet {
        Some(s) => s,
        None => book
            .sheet_collection()
            .first()
            .map(|s| s.name().to_string())
            .unwrap_or_else(|| "Sheet1".to_string()),
    }
}

pub fn format_range(path: &str, sheet: Option<String>, args: FormatArgs) -> Result<String, String> {
    if detect_format(path) != Format::Xlsx {
        return Err("unsupported_format: formatting is only supported for .xlsx files.".to_string());
    }
    let (c1, r1, c2, r2) = parse_range(&args.range).ok_or_else(|| format!("bad_range: '{}'", args.range))?;
    let mut book = open_existing(path)?;
    let sheet_name = target_sheet_name(&book, sheet);
    let worksheet = book
        .sheet_by_name_mut(&sheet_name)
        .map_err(|e| format!("sheet_missing: '{sheet_name}': {e}"))?;

    // Freeze panes (sheet-level), if requested.
    if args.freeze_rows.is_some() || args.freeze_cols.is_some() {
        let fr = args.freeze_rows.unwrap_or(0);
        let fc = args.freeze_cols.unwrap_or(0);
        let mut pane = umya_spreadsheet::Pane::default();
        pane.set_state(umya_spreadsheet::PaneStateValues::Frozen);
        pane.set_vertical_split(fc as f64);
        pane.set_horizontal_split(fr as f64);
        let mut top_left = umya_spreadsheet::Coordinate::default();
        top_left.set_col_num(fc + 1);
        top_left.set_row_num(fr + 1);
        pane.set_top_left_cell(top_left);
        pane.set_active_pane(umya_spreadsheet::PaneValues::BottomRight);
        let views = worksheet.sheet_views_mut().get_sheet_view_list_mut();
        if views.is_empty() {
            views.push(umya_spreadsheet::SheetView::default());
        }
        views[0].set_pane(pane);
    }

    // Column widths.
    if let Some(width) = args.column_width {
        for c in c1..=c2.min(c1 + 1024) {
            worksheet.get_column_dimension_by_number_mut(&c).set_width(width);
        }
    }

    // Cap the styled cell count so a "A:A" whole-column range can't explode.
    let r2 = r2.min(r1 + 50_000);
    let mut styled = 0usize;
    for r in r1..=r2 {
        for c in c1..=c2 {
            // Conditional fill takes precedence on matching cells.
            let cond_hit = if let Some(cond) = &args.conditional {
                let raw = worksheet.get_value((c, r));
                match parse_number(&raw) {
                    Some(n) => compare_op(&cond.op, n, cond.value),
                    None => false,
                }
            } else {
                false
            };

            let style = worksheet.get_style_mut((c, r));
            if let Some(bg) = &args.background {
                style.set_background_color(to_argb(bg));
            }
            if let Some(code) = &args.number_format {
                style.get_number_format_mut().set_format_code(number_format_code(code));
            }
            if args.bold.is_some() || args.italic.is_some() || args.font_size.is_some() || args.font_color.is_some() {
                let font = style.get_font_mut();
                if let Some(b) = args.bold {
                    font.set_bold(b);
                }
                if let Some(i) = args.italic {
                    font.set_italic(i);
                }
                if let Some(sz) = args.font_size {
                    font.set_size(sz);
                }
                if let Some(fc) = &args.font_color {
                    font.get_color_mut().set_argb_str(to_argb(fc));
                }
            }
            if args.border == Some(true) {
                let borders = style.get_borders_mut();
                borders.get_left_mut().set_border_style(umya_spreadsheet::Border::BORDER_THIN);
                borders.get_right_mut().set_border_style(umya_spreadsheet::Border::BORDER_THIN);
                borders.get_top_mut().set_border_style(umya_spreadsheet::Border::BORDER_THIN);
                borders.get_bottom_mut().set_border_style(umya_spreadsheet::Border::BORDER_THIN);
            }
            if cond_hit {
                if let Some(cond) = &args.conditional {
                    let style = worksheet.get_style_mut((c, r));
                    style.set_background_color(to_argb(&cond.background));
                    if let Some(fc) = &cond.font_color {
                        style.get_font_mut().get_color_mut().set_argb_str(to_argb(fc));
                    }
                }
            }
            styled += 1;
        }
    }

    umya_spreadsheet::writer::xlsx::write(&book, Path::new(path))
        .map_err(|e| format!("Failed to save xlsx {path}: {e:?}"))?;

    serde_json::to_string(&serde_json::json!({
        "status": "formatted",
        "path": path,
        "sheet": sheet_name,
        "range": args.range,
        "styled_cells": styled,
        "conditional_note": if args.conditional.is_some() {
            "Conditional formatting applied as static fills on matching cells (value-threshold). Live recalculating CF rules are not used."
        } else { "" },
    }))
    .map_err(|e| e.to_string())
}

fn compare_op(op: &str, a: f64, b: f64) -> bool {
    match op.trim().to_lowercase().as_str() {
        "gt" | ">" => a > b,
        "gte" | ">=" => a >= b,
        "lt" | "<" => a < b,
        "lte" | "<=" => a <= b,
        "eq" | "=" | "==" => (a - b).abs() < 1e-9,
        "ne" | "!=" | "<>" => (a - b).abs() >= 1e-9,
        _ => false,
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChartArgs {
    /// "bar" | "line" | "pie" | "area" | "doughnut" | "scatter"
    pub chart_type: String,
    /// Series data ranges, e.g. ["Sheet1!$B$2:$B$13"] (sheet-qualified, absolute).
    pub series: Vec<String>,
    #[serde(default)]
    pub series_titles: Option<Vec<String>>,
    #[serde(default)]
    pub categories: Option<Vec<String>>,
    #[serde(default)]
    pub title: Option<String>,
    /// Top-left anchor cell of the chart, e.g. "E2" (default).
    #[serde(default)]
    pub from_cell: Option<String>,
    /// Bottom-right anchor cell, e.g. "M20" (default).
    #[serde(default)]
    pub to_cell: Option<String>,
}

fn chart_type_of(name: &str) -> umya_spreadsheet::ChartType {
    use umya_spreadsheet::ChartType::*;
    match name.trim().to_lowercase().as_str() {
        "line" => LineChart,
        "pie" => PieChart,
        "doughnut" => DoughnutChart,
        "area" => AreaChart,
        "scatter" => ScatterChart,
        "radar" => RadarChart,
        _ => BarChart,
    }
}

pub fn add_chart(path: &str, sheet: Option<String>, args: ChartArgs) -> Result<String, String> {
    if detect_format(path) != Format::Xlsx {
        return Err("unsupported_format: charts are only supported for .xlsx files.".to_string());
    }
    if args.series.is_empty() {
        return Err("no_series: provide at least one sheet-qualified data range, e.g. \"Sheet1!$B$2:$B$13\".".to_string());
    }
    let mut book = open_existing(path)?;
    let sheet_name = target_sheet_name(&book, sheet);

    let mut from_marker = umya_spreadsheet::drawing::spreadsheet::MarkerType::default();
    let mut to_marker = umya_spreadsheet::drawing::spreadsheet::MarkerType::default();
    from_marker.set_coordinate(args.from_cell.clone().unwrap_or_else(|| "E2".to_string()));
    to_marker.set_coordinate(args.to_cell.clone().unwrap_or_else(|| "M20".to_string()));

    let series_refs: Vec<&str> = args.series.iter().map(|s| s.as_str()).collect();
    let mut chart = umya_spreadsheet::Chart::default();
    chart.new_chart(&chart_type_of(&args.chart_type), from_marker, to_marker, series_refs);
    if let Some(titles) = &args.series_titles {
        chart.set_series_title(titles.iter().map(|s| s.as_str()).collect());
    }
    if let Some(cats) = &args.categories {
        chart.set_series_point_title(cats.iter().map(|s| s.as_str()).collect());
    }
    if let Some(title) = &args.title {
        chart.set_title(title);
    }

    book.sheet_by_name_mut(&sheet_name)
        .map_err(|e| format!("sheet_missing: '{sheet_name}': {e}"))?
        .add_chart(chart);

    umya_spreadsheet::writer::xlsx::write(&book, Path::new(path))
        .map_err(|e| format!("Failed to save xlsx {path}: {e:?}"))?;

    serde_json::to_string(&serde_json::json!({
        "status": "chart_added",
        "path": path,
        "sheet": sheet_name,
        "chart_type": args.chart_type,
        "series_count": args.series.len(),
    }))
    .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Deserialize)]
pub struct TableArgs {
    /// A1 range covering the header + data, e.g. "A1:D200".
    pub range: String,
    #[serde(default)]
    pub name: Option<String>,
    /// Built-in Excel table style, default "TableStyleMedium2".
    #[serde(default)]
    pub style: Option<String>,
}

pub fn add_table(path: &str, sheet: Option<String>, args: TableArgs) -> Result<String, String> {
    if detect_format(path) != Format::Xlsx {
        return Err("unsupported_format: native tables are only supported for .xlsx files.".to_string());
    }
    let (c1, r1, c2, r2) = parse_range(&args.range).ok_or_else(|| format!("bad_range: '{}'", args.range))?;
    if r2 <= r1 {
        return Err("table_range_needs_header_and_data: the range must include a header row and at least one data row.".to_string());
    }
    let mut book = open_existing(path)?;
    let sheet_name = target_sheet_name(&book, sheet);
    let name = args.name.clone().unwrap_or_else(|| "Table1".to_string());
    let style = args.style.clone().unwrap_or_else(|| "TableStyleMedium2".to_string());

    let worksheet = book
        .sheet_by_name_mut(&sheet_name)
        .map_err(|e| format!("sheet_missing: '{sheet_name}': {e}"))?;

    // Header cells define the table columns (each must be non-empty and unique).
    let mut col_names: Vec<String> = Vec::new();
    for c in c1..=c2 {
        let raw = worksheet.get_value((c, r1));
        let mut nm = raw.trim().to_string();
        if nm.is_empty() {
            nm = format!("Column{}", c - c1 + 1);
        }
        // de-duplicate
        let mut candidate = nm.clone();
        let mut suffix = 2;
        while col_names.iter().any(|n| n.eq_ignore_ascii_case(&candidate)) {
            candidate = format!("{nm}{suffix}");
            suffix += 1;
        }
        col_names.push(candidate);
    }

    let mut table = umya_spreadsheet::Table::new(&name, ((c1, r1), (c2, r2)));
    for nm in &col_names {
        table.add_column(umya_spreadsheet::TableColumn::new(nm));
    }
    table.set_style_info(Some(umya_spreadsheet::TableStyleInfo::new(
        &style,
        umya_spreadsheet::ShowColumn::Hide,
        umya_spreadsheet::ShowColumn::Hide,
        umya_spreadsheet::ShowStripes::Show,
        umya_spreadsheet::ShowStripes::Hide,
    )));
    worksheet.add_table(table);

    umya_spreadsheet::writer::xlsx::write(&book, Path::new(path))
        .map_err(|e| format!("Failed to save xlsx {path}: {e:?}"))?;

    serde_json::to_string(&serde_json::json!({
        "status": "table_added",
        "path": path,
        "sheet": sheet_name,
        "table": name,
        "columns": col_names,
        "range": args.range,
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

    #[test]
    fn number_parsing_locales() {
        assert_eq!(parse_number("1,234.56"), Some(1234.56));
        assert_eq!(parse_number("1.234,56"), Some(1234.56));
        assert_eq!(parse_number("1 234,56"), Some(1234.56));
        assert_eq!(parse_number("12,5"), Some(12.5));
        assert_eq!(parse_number("1,234"), Some(1234.0));
        assert_eq!(parse_number("4 230 000 Ft"), Some(4_230_000.0));
        assert_eq!(parse_number("(50)"), Some(-50.0));
        assert_eq!(parse_number("-3.5%"), Some(-3.5));
        assert_eq!(parse_number("abc"), None);
        assert_eq!(parse_number(""), None);
    }

    #[test]
    fn date_detection() {
        assert!(looks_like_date("2024-06-24"));
        assert!(looks_like_date("2024/06/24 10:30"));
        assert!(looks_like_date("24.06.2024"));
        assert!(!looks_like_date("hello"));
        assert!(!looks_like_date("1234567"));
    }

    fn write_big_csv(path: &str, rows: usize) {
        let mut out = String::from("Region,Quarter,Amount\n");
        for i in 0..rows {
            let region = if i % 2 == 0 { "EU" } else { "US" };
            let quarter = if i % 4 < 2 { "Q1" } else { "Q2" };
            out.push_str(&format!("{region},{quarter},{}\n", (i as i64 % 100) + 1));
        }
        std::fs::write(path, out).expect("write big csv");
    }

    #[test]
    fn profile_reports_column_stats() {
        let path = tmp("profile.csv");
        write_big_csv(&path, 1000);
        let json = profile(&path, None, Some(5)).expect("profile");
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["row_count"], 1000);
        assert_eq!(v["col_count"], 3);
        let cols = v["columns"].as_array().unwrap();
        let amount = cols.iter().find(|c| c["name"] == "Amount").unwrap();
        assert_eq!(amount["type"], "number");
        assert!(amount["sum"].as_f64().unwrap() > 0.0);
        let region = cols.iter().find(|c| c["name"] == "Region").unwrap();
        assert_eq!(region["type"], "text");
        assert_eq!(region["unique"], 2);
        assert!(v["sample"]["head"].as_array().unwrap().len() <= 5);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn query_aggregate_with_filter() {
        let path = tmp("query.csv");
        write_big_csv(&path, 1000); // Amount = (i % 100) + 1, repeating
        let args = QueryArgs {
            filter: Some(Filter {
                match_mode: "all".into(),
                conditions: vec![Condition {
                    column: "Quarter".into(),
                    op: "eq".into(),
                    value: serde_json::json!("Q2"),
                }],
            }),
            aggregate: Some(vec![
                AggSpec { op: "sum".into(), column: Some("Amount".into()), label: None },
                AggSpec { op: "count".into(), column: None, label: None },
            ]),
            ..Default::default()
        };
        let json = query(&path, None, args).expect("query");
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["matched_rows"], 500);
        assert_eq!(v["aggregates"]["count"], 500);
        assert!(v["aggregates"]["sum_Amount"].as_f64().unwrap() > 0.0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn query_group_by() {
        let path = tmp("query_group.csv");
        write_big_csv(&path, 1000);
        let args = QueryArgs {
            aggregate: Some(vec![AggSpec { op: "count".into(), column: None, label: None }]),
            group_by: Some(vec!["Region".into()]),
            ..Default::default()
        };
        let json = query(&path, None, args).expect("query group");
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["group_count"], 2);
        let groups = v["groups"].as_array().unwrap();
        assert_eq!(groups.len(), 2);
        for g in groups {
            assert_eq!(g["aggregates"]["count"], 500);
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn typed_writes_numbers_and_formulas() {
        let path = tmp("typed.xlsx");
        let _ = std::fs::remove_file(&path);
        write(
            &path,
            None,
            Some(vec![
                vec!["Item".into(), "Amount".into()],
                vec!["A".into(), "10".into()],
                vec!["B".into(), "20.5".into()],
                vec!["ID".into(), "007".into()],
                vec!["Total".into(), "=SUM(B2:B3)".into()],
            ]),
            None,
            None,
            Some("new".into()),
        )
        .expect("write typed");

        // Re-open with umya and assert types.
        let book = umya_spreadsheet::reader::xlsx::read(Path::new(&path)).expect("reopen");
        let ws = book.sheet_by_name("Sheet1").expect("sheet");
        assert_eq!(ws.get_cell((2, 2)).unwrap().data_type(), "n", "B2 should be numeric");
        assert_eq!(ws.get_cell((2, 3)).unwrap().data_type(), "n", "B3 should be numeric");
        // "007" preserved as text
        assert_eq!(ws.get_value((2, 4)), "007");
        // formula stored without leading '='
        assert_eq!(ws.get_cell((2, 5)).unwrap().formula(), "SUM(B2:B3)");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn excel_serial_known_dates() {
        // 1900-01-01 == serial 2 in Excel's (buggy) 1900 system.
        assert_eq!(excel_date_serial("1900-01-01"), Some(2.0));
        // 2024-01-01 == 45292.
        assert_eq!(excel_date_serial("2024-01-01"), Some(45292.0));
        assert_eq!(excel_date_serial("not-a-date"), None);
    }

    #[test]
    fn format_range_applies_conditional_fill() {
        let path = tmp("fmt.xlsx");
        let _ = std::fs::remove_file(&path);
        write(
            &path,
            None,
            Some(vec![
                vec!["Val".into()],
                vec!["-5".into()],
                vec!["10".into()],
                vec!["-3".into()],
            ]),
            None,
            None,
            Some("new".into()),
        )
        .expect("write");

        let args = FormatArgs {
            range: "A2:A4".into(),
            conditional: Some(ConditionalSpec {
                op: "lt".into(),
                value: 0.0,
                background: "#FF0000".into(),
                font_color: None,
            }),
            ..Default::default()
        };
        format_range(&path, None, args).expect("format");

        let book = umya_spreadsheet::reader::xlsx::read(Path::new(&path)).expect("reopen");
        let ws = book.sheet_by_name("Sheet1").expect("sheet");
        // Negative cells get the red fill; the positive one does not.
        let neg = ws.get_style((1, 2)).get_background_color().map(|c| c.argb_str()).unwrap_or_default();
        assert!(neg.ends_with("FF0000"), "A2 fill = {neg}");
        let pos = ws.get_style((1, 3)).get_background_color().map(|c| c.argb_str()).unwrap_or_default();
        assert!(!pos.ends_with("FF0000"), "A3 should not be red, got {pos}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn chart_and_table_insert() {
        let path = tmp("chart.xlsx");
        let _ = std::fs::remove_file(&path);
        let mut rows = vec![vec!["Month".into(), "Sales".into()]];
        for i in 1..=6 {
            rows.push(vec![format!("M{i}"), format!("{}", i * 100)]);
        }
        write(&path, None, Some(rows), None, None, Some("new".into())).expect("write");

        add_chart(
            &path,
            None,
            ChartArgs {
                chart_type: "bar".into(),
                series: vec!["Sheet1!$B$2:$B$7".into()],
                series_titles: Some(vec!["Sales".into()]),
                categories: None,
                title: Some("Monthly Sales".into()),
                from_cell: None,
                to_cell: None,
            },
        )
        .expect("chart");

        add_table(
            &path,
            None,
            TableArgs { range: "A1:B7".into(), name: Some("Sales".into()), style: None },
        )
        .expect("table");

        let book = umya_spreadsheet::reader::xlsx::read(Path::new(&path)).expect("reopen");
        let ws = book.sheet_by_name("Sheet1").expect("sheet");
        assert!(!ws.get_tables().is_empty(), "table missing");
        let _ = std::fs::remove_file(&path);
    }
}
