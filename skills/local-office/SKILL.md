---
name: local-office
description: "Create/read local Excel, CSV, text and document files directly without GUI Office control."
allowed_tools: ["document.read", "doc.read", "doc.write_txt", "doc.write_docx", "sheet.read", "sheet.write", "sheet.append", "sheet.export_csv", "sheet.to_json", "file.exists"]
requires_connections: []
risk: "local_write"
trigger: "excel xlsx csv word docx txt local office libreoffice"
---

# Local Office
1. For Excel, write `.xlsx` with `sheet.write`; for CSV use `.csv`.
2. Read back with `sheet.read`/`sheet.to_json` before completion.
3. For Word-like local output, prefer `doc.write_docx` when requested or `doc.write_txt` for plain text.
4. Opening Word/Excel is optional preview only; no GUI editing.
5. Google Sheets/Docs requests are cloud targets, not local Office targets.
