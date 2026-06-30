---
name: "spreadsheet-refresh"
description: "Refresh local or Google spreadsheets by reading, profiling, updating, appending, formatting, and verifying changed ranges."
version: "1.0.0"
categories: ["office-results", "spreadsheet", "data"]
trigger: "spreadsheet refresh sheet update tablazat frissites excel google sheets range"
trigger_phrases: ["spreadsheet refresh", "sheet update", "tablazat frissites", "Google Sheets update", "Excel refresh"]
when_to_use: ["Use for updating, appending, cleaning, formatting, or refreshing spreadsheet data."]
when_not_to_use: ["Do not use for unrelated document summaries unless spreadsheet output is required."]
allowed_tools: ["sheet.read", "sheet.profile", "sheet.query", "sheet.write", "sheet.append", "sheet.update_cells", "sheet.to_json", "sheet.format_range", "sheet.add_table", "sheet.add_chart", "connection.call", "ask_user"]
requires_connections: []
risk: "external_write"
verification_checklist: ["Read/profile the sheet before modification.", "Use the narrowest update range possible.", "Read back the affected range.", "For report workbooks, add visible formatting/table/chart when requested."]
supports_automation: true
supports_manual_run: true
---

# Spreadsheet Refresh

## Workflow
1. Identify whether the target is local XLSX/CSV/ODS or Google Sheets.
2. Read/profile current headers, row count, and important formulas.
3. Plan append/update/overwrite behavior.
4. Update the smallest safe range.
5. Read the affected range back and compare expected values.

## Verification
- Completion requires changed-range read-back.
- Professional local reports require formatting, table, chart, and read-back.
