---
name: google-sheets-web
description: "Create and populate a CLOUD Google Sheet (sheets.new / docs.google.com) via the browser or a Google connection — never a local file."
allowed_tools: ["browser.open", "browser.read", "browser.get_state", "browser.wait", "browser.click", "browser.type", "browser.shortcut", "browser.paste", "browser.assert_text", "clipboard.set", "connection.call", "ask_user"]
requires_connections: []
risk: "external_write"
trigger: "create or fill a Google Sheet / Google táblázat / sheets.new / the open Google spreadsheet"
---

# Google Sheets (Web)

A **Google Sheet is a cloud document**. It is NOT the local `sheet.write` tool.
Creating a local `.xlsx`/`.csv` does NOT satisfy a Google Sheets task.

Decision:
- If a Google Workspace **connection is configured**, prefer it:
  `connection.call google-workspace sheets.write` (and `sheets.read` to verify).
- Otherwise use the **browser workflow** below.
- Only use local `sheet.write` if the user explicitly asked for an Excel/CSV file.

Browser workflow:
1. `browser.open` `https://sheets.new` (or the given spreadsheet URL).
2. `browser.wait` + `browser.read`. Check `STATE_HINTS`.
3. If `login_required`: `ask_user` to log in ("…majd írd: kész"), then resume.
4. When the sheet is ready, build the data as **TSV** (tab-separated, newline rows),
   e.g. `Név\tEmail\tStátusz\nKovács János\t...\t...`.
5. `clipboard.set` the TSV, then `browser.paste` into the grid. On a fresh
   `sheets.new`, cell **A1 is already focused**, so paste lands correctly.
   - If you cannot be sure the grid is focused, `ask_user`: "Kattints az A1 cellába,
     majd írd: kész." Then paste.
6. `browser.read` / `browser.assert_text` to confirm the rows are in the grid.
7. Only then `task.complete`.

If the user asked for "at least N rows" with no data, generate plausible sample
rows instead of asking. Never write into the sheet **title** box — that is not the grid.
