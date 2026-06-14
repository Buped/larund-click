// Bundled skills. Kept inline (not `?raw`) so the runtime and the test runner
// have a single, dependency-free source of truth. The matching human-facing
// SKILL.md files live under /skills and document the same workflows.

const fileOrganizer = `---
name: file-organizer
description: "Organize, rename, sort and restructure local files using deterministic file tools with previews and approvals."
allowed_tools: ["file.list", "file.tree", "file.search", "file.mkdir", "file.move", "file.copy", "file.delete", "approval.request"]
requires_connections: []
risk: "local_write"
trigger: "organize sort clean rename restructure files folders downloads projects"
---

# File Organizer
1. Inspect with file.list / file.tree.
2. Classify into categories.
3. Propose a plan; stop here if a dry-run was requested.
4. Ask approval before moving or deleting many files.
5. Execute file.mkdir then file.move/copy. Never delete without approval.
6. Summarize all changes.`;

const browserAutomation = `---
name: browser-automation
description: "Drive websites via the browser DOM/CDP tools (read/click/type/paste/extract) — never the mouse or screen pixels."
allowed_tools: ["browser.open", "browser.read", "browser.get_state", "browser.click", "browser.type", "browser.key", "browser.shortcut", "browser.paste", "browser.assert_text", "browser.assert_url", "browser.wait", "browser.extract_table", "browser.download", "browser.upload", "clipboard.set", "ask_user"]
requires_connections: []
risk: "external_write"
trigger: "open website fill form extract data log into web app browser"
---

# Browser Automation
1. browser.open then browser.wait + browser.read/get_state (URL/title/focus/inputs/STATE_HINTS).
2. Check state: login_required/captcha/permission_required = manual blocker -> ask_user, resume.
3. Act by element text/selector; browser.type errors AMBIGUOUS -> use a more specific target.
4. Re-read after EVERY state-changing action; verify with assert_text/assert_url.
5. Opening a page is NOT completion unless the user only asked to open it. Never use a mouse.`;

const googleSheetsWeb = `---
name: google-sheets-web
description: "Create/populate a CLOUD Google Sheet (sheets.new / docs.google.com) via browser or Google connection — never a local file."
allowed_tools: ["browser.open", "browser.read", "browser.get_state", "browser.wait", "browser.click", "browser.type", "browser.shortcut", "browser.paste", "browser.assert_text", "clipboard.set", "connection.call", "ask_user"]
requires_connections: []
risk: "external_write"
trigger: "google sheet google táblázat sheets.new spreadsheet online open google spreadsheet fill upload"
---

# Google Sheets (Web)
A Google Sheet is a CLOUD doc, NOT local sheet.write. A local .xlsx/.csv does NOT satisfy it.
1. If google-workspace connection configured -> connection.call sheets.write + sheets.read to verify.
2. Else browser: browser.open https://sheets.new -> wait/read. If login_required -> ask_user, resume.
3. Build TSV rows; clipboard.set the TSV; browser.paste into the grid (A1 is focused on a fresh sheet).
4. browser.read/assert_text to confirm rows are in the grid, THEN task.complete.
5. "at least N rows" with no data -> generate sample rows. Never write into the title box.`;

const googleSheets = `---
name: google-sheets
description: "Create, write, append, read and verify cloud Google Sheets via the Google Workspace connection."
allowed_tools: ["connection.call", "ask_user"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google sheet google sheets online spreadsheet sheets.new szamla konyveles"
---

# Google Sheets
1. Use google.sheets.create if a new cloud sheet is needed.
2. Use google.sheets.write_values or google.sheets.append_values for rows.
3. Always call google.sheets.read_values after writing and verify expected values.
4. A local .xlsx or .csv never completes a Google Sheets request unless the user changes the target.
5. If auth is missing, ask for Google Workspace setup or offer local .xlsx as an explicit fallback.`;

const googleWorkspace = `---
name: google-workspace
description: "Use Google Workspace through API-first connection tools; browser fallback only when explicitly needed."
allowed_tools: ["connection.call", "browser.open", "browser.read", "browser.wait", "ask_user"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google workspace google drive google sheets google docs gmail calendar"
---

# Google Workspace
1. Prefer connection.call with google-workspace tools.
2. If auth is missing, ask the user to connect Google Workspace or offer a local file fallback when acceptable.
3. Never satisfy a Google cloud document request with only a local file.
4. Verify every create/write by reading metadata, values or content back.
5. Browser fallback must use DOM/read-back only; no mouse or visual control.`;

const googleDocs = `---
name: google-docs
description: "Create, fill, read and export Google Docs through the Google Workspace connection."
allowed_tools: ["connection.call", "ask_user", "doc.write_txt", "doc.write_docx"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google docs google doc document invoice szamla"
---

# Google Docs
1. Use google.docs.create for new cloud docs.
2. Insert content with google.docs.insert_text or google.docs.batch_update.
3. Read back with google.docs.read before completion.
4. Export through Drive with google.docs.export_docx or google.docs.export_pdf when requested.
5. If auth is missing, ask to connect Google or offer local .docx/.txt as a fallback.`;

const localOffice = `---
name: local-office
description: "Create/read local Excel, CSV, text and document files directly without GUI Office control."
allowed_tools: ["document.read", "doc.read", "doc.write_txt", "doc.write_docx", "sheet.read", "sheet.write", "sheet.append", "sheet.export_csv", "sheet.to_json", "file.exists"]
requires_connections: []
risk: "local_write"
trigger: "excel xlsx csv word docx txt local office libreoffice"
---

# Local Office
1. For Excel, write .xlsx with sheet.write; for CSV use .csv.
2. Read back with sheet.read/sheet.to_json before completion.
3. For Word-like local output, prefer doc.write_docx when requested or doc.write_txt for plain text.
4. Opening Word/Excel is optional preview only; no GUI editing.
5. Google Sheets/Docs requests are cloud targets, not local Office targets.`;

const documentAccounting = `---
name: document-accounting
description: "Read referenced invoices and create an accounting table in local xlsx/csv or Google Sheets."
allowed_tools: ["document.read", "document.read_many", "folder.scan", "folder.read_relevant", "sheet.write", "sheet.read", "connection.call", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "invoice szamla accounting konyvel konyveles xlsx google sheet"
---

# Document Accounting
1. Read all referenced invoice files first with document.read/document.read_many; for folders use folder.scan then folder.read_relevant.
2. Extract invoice number, issuer, customer, date, item, net, gross/total and currency.
3. If target is local Excel, use sheet.write to .xlsx and sheet.read back.
4. If target is Google Sheets, use the Google connection and read values back.
5. Complete only when source files read and output rows verified.`;

const taskVerification = `---
name: task-verification
description: "Before completing, verify the requested outcome actually exists with a read-back appropriate to the surface."
allowed_tools: ["file.exists", "file.list", "file.tree", "file.read", "sheet.read", "browser.read", "browser.get_state", "browser.assert_text", "browser.assert_url", "connection.call"]
requires_connections: []
risk: "read_only"
trigger: "verify confirm check done complete read back outcome"
---

# Task Verification
Prove the outcome; never trust "done" alone (the runtime guard re-checks).
- Local files -> file.exists/list/tree; read back writes; confirm source+dest for moves.
- Local spreadsheet -> sheet.read the rows. Cloud Google Sheet -> browser.assert_text or connection sheets.read (a local file does NOT count).
- Browser/webapp -> after a change, browser.read + assert_text/assert_url. Opening a page is not proof.
- If a login/captcha/permission wall blocks verification -> ask_user and resume; never complete.`;

const vscodeProject = `---
name: vscode-project
description: "Open projects in VS Code from the CLI, edit files, run tests and read git diffs — keyboard/CLI only, no mouse."
allowed_tools: ["app.open", "cli.run", "file.read", "file.write", "file.edit", "file.tree", "file.search", "keyboard.combo"]
requires_connections: []
risk: "process_exec"
trigger: "open project vs code run tests fix failing tests git diff coding"
---

# VS Code Project Workflow
1. code --reuse-window <folder>. 2. file.tree/search to scan.
3. Edit with file.edit/write. 4. cli.run tests/build. 5. git diff. Never click in VS Code.`;

const githubMaintainer = `---
name: github-maintainer
description: "Maintain GitHub repos via the GitHub connection: read files, list/comment issues, create branches and open PRs."
allowed_tools: ["connection.call", "approval.request", "ask_user"]
requires_connections: ["github"]
risk: "external_write"
trigger: "github repo readme pull request issue branch commit"
---

# GitHub Maintainer
1. If github not configured, ask_user. 2. Read via connection.call (read_file/list_issues/search_repos).
3. Writes (write_file/open_pr/comment_issue) need approval.request. 4. Report URLs.`;

const notionWorkspace = `---
name: notion-workspace
description: "Read and write Notion pages and databases via the Notion connection, with approval for writes."
allowed_tools: ["connection.call", "approval.request", "ask_user"]
requires_connections: ["notion"]
risk: "external_write"
trigger: "notion page database row update create query workspace"
---

# Notion Workspace
1. If notion not configured, ask_user. 2. Read via search/read_page/query_database.
3. Writes (create_page/update_page/create_database_row) need approval. 4. Report page URL.`;

const marketingReport = `---
name: marketing-report
description: "Compile a marketing report by reading spreadsheets/CSVs and web sources, then writing a summary file."
allowed_tools: ["sheet.read", "file.read", "file.write", "browser.open", "browser.read", "browser.extract_table", "connection.call"]
requires_connections: []
risk: "local_write"
trigger: "marketing report weekly metrics summary analytics dashboard compile"
---

# Marketing Report
1. Gather inputs (sheet.read, browser.*, connection.call).
2. Aggregate key metrics + deltas. 3. file.write the report (Markdown).
4. Summarize what changed and where it was saved. Never screenshot dashboards.`;

export const BUNDLED_SKILL_FILES: string[] = [
  fileOrganizer,
  browserAutomation,
  googleSheetsWeb,
  googleSheets,
  googleWorkspace,
  googleDocs,
  localOffice,
  documentAccounting,
  taskVerification,
  vscodeProject,
  githubMaintainer,
  notionWorkspace,
  marketingReport,
];
