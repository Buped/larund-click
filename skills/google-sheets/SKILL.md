---
name: google-sheets
description: "Create, write, append, read and verify cloud Google Sheets via the Google Workspace connection."
allowed_tools: ["connection.call", "ask_user"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google sheet google sheets online spreadsheet sheets.new"
---

# Google Sheets
1. Use `google.sheets.create` if a new cloud sheet is needed.
2. Use `google.sheets.write_values` or `google.sheets.append_values` for rows.
3. Always call `google.sheets.read_values` or `google.sheets.get_metadata` after writing.
4. A local `.xlsx` or `.csv` never completes a Google Sheets request unless the user changes the target.
5. If auth is missing, ask for Google connection setup or offer local `.xlsx` as an explicit fallback.
