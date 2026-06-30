---
name: local-office
description: "Create/read local Excel, CSV, text and document files directly without GUI Office control, to a professional XLSX report standard."
allowed_tools: ["document.read", "doc.read", "doc.write_txt", "doc.write_docx", "sheet.read", "sheet.write", "sheet.update_cells", "sheet.append", "sheet.export_csv", "sheet.to_json", "sheet.format_range", "sheet.add_table", "sheet.add_chart", "file.exists"]
requires_connections: []
risk: "local_write"
trigger: "excel xlsx csv word docx txt local office libreoffice report riport workbook spreadsheet helyi táblázat"
when_to_use: ["Use for a local Excel/CSV/Word file the user wants on disk.", "Use when a polished .xlsx report/workbook is requested."]
when_not_to_use: ["Do not use for a cloud Google Sheet/Doc (that is a connection/browser task)."]
---

# Local Office

Create local Excel, CSV and document files directly — no GUI Office control.

## Basics
1. For Excel, write `.xlsx` with `sheet.write`; for CSV use `.csv`.
2. Read back with `sheet.read` or `sheet.to_json` before completion.
3. For Word-like local output, prefer `doc.write_docx` when requested, or `doc.write_txt` for plain text.
4. Opening Word/Excel is optional preview only; no GUI editing.
5. Google Sheets/Docs requests are cloud targets, not local Office targets — use the google-sheets / google-sheets-web skill instead.

## Original target file & source preservation
- If the user gave a local spreadsheet path and said "write into it / fill it / update it / edit it", that same file is the mutation target. Never silently create a sibling file and call it done.
- Prefer `sheet.update_cells` for targeted edits — it preserves existing rows, headers, formulas and unrelated cells better than rewriting the whole sheet.
- For `.ods` input, do not produce a `.xlsx` sibling as the deliverable unless the user approved a format change. Acceptable: direct ODS write, or ODS -> temporary XLSX -> ODS round-trip with a `.backup.ods`, then read back from the original `.ods`. If a safe round-trip is unavailable, `ask_user` before changing format.

## EXCEL REPORT STANDARD — professional XLSX workbooks
- If the user asks for an Excel table/report/workbook, default to `.xlsx`, not `.csv`, unless they explicitly asked for CSV or raw export. XLSX is required for native formatting, tables, multiple sheets, formulas and charts.
- Treat broad wording like "and everything like that", "meg minden ilyesmi", "detailed/expanded data" or "performance table" as permission to design a richer business schema. Do not stop at 4-5 obvious columns when a professional report is expected.
- For a store/retail performance report, include a broad schema such as: Store ID, store name, region, city, store type, opening date, current monthly revenue, previous monthly revenue, change %, customer count, average basket value, conversion %, inventory turnover, stockout %, return %, employee count, customer rating, performance score, trend, risk level, notes.
- If the user requests at least N rows/items, create N or more real data rows and verify the count. For "minimum 50", the workbook must contain at least 50 real data rows — not 50-looking labels or a partial sample.
- Professional standard: create at least a main data sheet plus a summary sheet; add a native Excel Table over the main data range with filterable headers and banded rows; format headers, freeze the top row, set useful column widths, apply currency/percent/date formats, use conditional coloring for change/risk metrics, and add at least one relevant chart (e.g. top stores by revenue or regional performance).
- Always use `sheet.add_table` on the main report range. It applies visible static styling too: dark header, banded row fills, borders, and KPI color fills for common change/risk/trend/stockout/return columns, so the workbook looks good in LibreOffice as well as Excel. Do not rely on unstyled `sheet.write` output for reports.
- Recommended sequence: `sheet.write` the main data and summary, `sheet.format_range` for headers/widths/number formats/conditional fills, `sheet.add_table` on the main range, `sheet.add_chart` for the key visual, then `sheet.read or sheet.to_json` to verify sheet names, row count, column count and representative values before `task.complete`.
- Regression: if the user explicitly asks for CSV or "raw data only", keep it simple and do not force charts or extra sheets.

## Typed values + real formatting, not a plain grid
- `sheet.write` stores types automatically: numbers become numbers (so SUM/AVERAGE and number formats work natively), a leading `=` becomes a real formula, ISO dates (YYYY-MM-DD) become date cells. Pass `"=SUM(B2:B13)"` to write a working formula.
- A bare unformatted grid is a low-quality deliverable for a client report — format it.

## Action shapes (exact JSON)
{"action":"sheet.update_cells","path":"<LOCAL .xlsx/.ods/.csv path>","sheet":"<optional>","cells":[{"row":2,"column":"B","value":"https://example.com"}],"preserveExisting":true,"backup":true}
{"action":"sheet.export_csv","path":"<LOCAL .xlsx path>","target_path":"<csv path>"}
{"action":"sheet.to_json","path":"<LOCAL .xlsx/.csv path>","max_rows":<optional>}
{"action":"sheet.format_range","path":"<LOCAL .xlsx path>","range":"A1:D1","background":"#1F2937","font_color":"#FFFFFF","bold":true,"freeze_rows":1,"number_format":"currency_huf","conditional":{"op":"lt","value":0,"background":"#FF0000"}}
{"action":"sheet.add_table","path":"<LOCAL .xlsx path>","range":"A1:D200","name":"Campaigns","style":"TableStyleMedium2"}
{"action":"sheet.add_chart","path":"<LOCAL .xlsx path>","chart_type":"bar","series":["Sheet1!$B$2:$B$13"],"series_titles":["Revenue"],"title":"Monthly revenue","from_cell":"E2","to_cell":"M20"}

## Verification
- Read the workbook back (`sheet.read` / `sheet.to_json`); confirm sheet names, row count, column count and representative values match the request before completing.
