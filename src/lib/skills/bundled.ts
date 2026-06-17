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
Use this skill when the user asks to clean, sort, rename, archive, deduplicate, or restructure local files and folders.

## Process
1. Inspect the target with file.list, file.tree, and file.search before proposing changes.
2. Identify file types, project names, dates, and likely categories from names and metadata.
3. Present a deterministic plan when the change is broad, destructive, or affects many files.
4. Create destination folders with file.mkdir before moving files.
5. Move or copy with file.move/file.copy. Never delete without explicit approval.
6. Re-list the final folders and summarize every changed path.

## Verification
- For reorganizations, run file.tree or file.list on the destination and source.
- For renames/moves, confirm the old path is gone and the new path exists.
- For dry runs, stop after the plan and do not mutate files.

## Rules
- Do not use mouse, screenshots, OCR, or pixel targeting.
- If a target path is ambiguous, ask_user before changing files.`;

const browserAutomation = `---
name: browser-automation
description: "Drive websites via the browser DOM/CDP tools (read/click/type/paste/extract) — never the mouse or screen pixels."
allowed_tools: ["browser.open", "browser.read", "browser.get_state", "browser.click", "browser.type", "browser.key", "browser.shortcut", "browser.paste", "browser.assert_text", "browser.assert_url", "browser.wait", "browser.extract_table", "browser.download", "browser.upload", "clipboard.set", "ask_user"]
requires_connections: []
risk: "external_write"
trigger: "open website fill form extract data log into web app browser"
---

# Browser Automation
Use this skill for web tasks that can be completed through DOM/CDP browser tools: opening pages, reading data, filling forms, clicking accessible elements, uploading files, downloading files, or extracting tables.

## Process
1. Open the target with browser.open, then run browser.wait and browser.read or browser.get_state.
2. Inspect URL, title, visible text, inputs, buttons, and page state hints.
3. If login, 2FA, CAPTCHA, paywall, or permission is required, ask_user for a manual step and resume after confirmation.
4. Act only by DOM text, labels, roles, selectors, keyboard shortcuts, paste, upload, or download.
5. After every state-changing action, read the page again and verify the expected change.

## Verification
- Use browser.assert_text or browser.assert_url for final proof when possible.
- Extract tables with browser.extract_table instead of screenshots.
- Opening a page is not completion unless the user only asked to open it.

## Rules
- Never use a mouse, cursor, coordinates, screenshots, OCR clicks, or visual pixel targeting.
- If browser.type reports ambiguity, choose a more specific selector or ask_user.`;

const googleSheetsWeb = `---
name: google-sheets-web
description: "Create/populate a CLOUD Google Sheet (sheets.new / docs.google.com) via browser or Google connection — never a local file."
allowed_tools: ["browser.open", "browser.read", "browser.get_state", "browser.wait", "browser.click", "browser.type", "browser.shortcut", "browser.paste", "browser.assert_text", "clipboard.set", "connection.call", "ask_user"]
requires_connections: []
risk: "external_write"
trigger: "google sheet google táblázat sheets.new spreadsheet online open google spreadsheet fill upload"
---

# Google Sheets (Web)
A Google Sheet is a cloud document, not a local .xlsx or .csv file. Use this skill when the user explicitly asks for Google Sheets, sheets.new, an online spreadsheet, or the currently open Google Sheet.

## Process
1. Prefer the Google Workspace connection when configured: create/open the sheet, write or append values, then read values back.
2. If the connection is unavailable but browser work is acceptable, open https://sheets.new and read the page state.
3. If login is required, ask_user to sign in and resume the same task.
4. Build tab-separated rows and paste them into the grid, not the title box.
5. If the user asks for a minimum number of rows without providing data, generate reasonable sample rows.

## Verification
- With the API, call a read_values tool after writing and compare expected values.
- With the browser, use browser.read/assert_text or another DOM read-back to confirm rows are visible.
- A local spreadsheet file alone never completes a Google Sheets task.`;

const googleSheets = `---
name: google-sheets
description: "Create, write, append, read and verify cloud Google Sheets via the Google Workspace connection."
allowed_tools: ["connection.call", "ask_user"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google sheet google sheets online spreadsheet sheets.new szamla konyveles"
---

# Google Sheets
Use this skill for API-first Google Sheets work through the Google Workspace connection.

## Process
1. Confirm whether the user wants a new sheet, an existing sheet, append, overwrite, formatting, or export.
2. Use google.sheets.create for new cloud sheets.
3. Use google.sheets.write_values or google.sheets.append_values for tabular data.
4. Preserve user-provided headers and row order unless asked to transform them.
5. If credentials are missing, block and ask the user to connect Google Workspace or approve an explicit local fallback.

## Verification
- Always call google.sheets.read_values after writing.
- Compare expected headers, row count, and important values.
- Do not complete a cloud Google Sheets request with only a local file.`;

const googleWorkspace = `---
name: google-workspace
description: "Use Google Workspace through API-first connection tools; browser fallback only when explicitly needed."
allowed_tools: ["connection.call", "browser.open", "browser.read", "browser.wait", "ask_user"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google workspace google drive google sheets google docs gmail calendar"
---

# Google Workspace
Use this skill when the task spans Google Drive, Docs, Sheets, Gmail, or Calendar and should be handled through structured Google APIs when possible.

## Process
1. Identify the exact Google surface and operation: read, create, update, send, share, export, schedule, or search.
2. Prefer connection.call with google-workspace tools.
3. If auth is missing, show a blocker and ask the user to connect Google Workspace.
4. For browser fallback, use browser DOM/CDP tools only and re-read state after changes.
5. For external sends or sharing, expect approval before sending/publishing.

## Verification
- Read metadata, document content, sheet values, calendar event details, or message status back.
- Never satisfy a Google cloud document request with only a local artifact unless the user explicitly changes the target.`;

const googleDocs = `---
name: google-docs
description: "Create, fill, read and export Google Docs through the Google Workspace connection."
allowed_tools: ["connection.call", "ask_user", "doc.write_txt", "doc.write_docx"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google docs google doc document invoice szamla"
---

# Google Docs
Use this skill to create, update, read, export, or verify Google Docs.

## Process
1. Confirm whether the target is a cloud Google Doc or a local document.
2. Use google.docs.create for new cloud docs.
3. Insert or update content with google.docs.insert_text or google.docs.batch_update.
4. Use Drive export tools for PDF/DOCX exports when requested.
5. If auth is missing, ask the user to connect Google Workspace or approve a local fallback.

## Verification
- Read the Google Doc content back before completing.
- For exports, confirm the exported file exists and can be read/opened by file tools.
- Do not claim a cloud doc exists unless the Google API or browser state confirms it.`;

const localOffice = `---
name: local-office
description: "Create/read local Excel, CSV, text and document files directly without GUI Office control."
allowed_tools: ["document.read", "doc.read", "doc.write_txt", "doc.write_docx", "sheet.read", "sheet.write", "sheet.append", "sheet.export_csv", "sheet.to_json", "file.exists"]
requires_connections: []
risk: "local_write"
trigger: "excel xlsx csv word docx txt local office libreoffice"
---

# Local Office
Use this skill for local spreadsheet, CSV, DOCX, TXT, and office-style file work when the user wants files on disk.

## Process
1. Determine the requested local format and output path.
2. For spreadsheets, use sheet.write, sheet.append, sheet.export_csv, or sheet.to_json.
3. For text/DOCX output, use doc.write_txt or doc.write_docx.
4. Avoid GUI Office automation. Opening a file is preview only, not editing.
5. If the user asked for Google Sheets or Google Docs, switch to the cloud skill instead.

## Verification
- Read spreadsheet outputs with sheet.read or sheet.to_json.
- Read document outputs with doc.read or file.read as appropriate.
- Confirm the exact file path exists before completion.`;

const documentAccounting = `---
name: document-accounting
description: "Read referenced invoices and create an accounting table in local xlsx/csv or Google Sheets."
allowed_tools: ["document.read", "document.read_many", "folder.scan", "folder.read_relevant", "sheet.write", "sheet.read", "connection.call", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "invoice szamla accounting konyvel konyveles xlsx google sheet"
---

# Document Accounting
Use this skill when the user references invoices, receipts, folders of documents, or asks for accounting/bookkeeping extraction into a table.

## Process
1. Read every referenced invoice with document.read or document.read_many.
2. For folders, scan first, select relevant files, then read the relevant documents.
3. Extract invoice number, issuer, customer, date, line item, net, tax, gross total, and currency.
4. Preserve uncertainty explicitly rather than inventing missing values.
5. Write the requested output: local XLSX/CSV through sheet tools or cloud Google Sheets through the Google connection.

## Verification
- Confirm all source files were read or report which files could not be read.
- Read the output rows back and compare row count/key totals.
- Completion requires both source read evidence and output read-back evidence.`;

const taskVerification = `---
name: task-verification
description: "Before completing, verify the requested outcome actually exists with a read-back appropriate to the surface."
allowed_tools: ["file.exists", "file.list", "file.tree", "file.read", "sheet.read", "browser.read", "browser.get_state", "browser.assert_text", "browser.assert_url", "connection.call"]
requires_connections: []
risk: "read_only"
trigger: "verify confirm check done complete read back outcome"
---

# Task Verification
Use this skill before task.complete and whenever a task result needs proof.

## Principles
- Never trust task.complete without evidence.
- Choose the read-back method that matches the actual target surface.
- If verification fails, keep working or report blocked/failed. Do not claim completion.

## Read-back methods
1. Local files: file.exists, file.list/file.tree, then file.read/doc.read/sheet.read for written content.
2. Local spreadsheets: sheet.read or sheet.to_json and compare expected rows.
3. Google Sheets: connection read_values or browser DOM assertion. A local file does not count.
4. Google Docs: google.docs.read/export or browser/document read-back.
5. Browser tasks: browser.read plus assert_text/assert_url after any state-changing action.
6. Connections/MCP: read the provider response or query the created/updated object.

## Blockers
- Login, CAPTCHA, permissions, missing auth, or unavailable tools require ask_user or a blocked status.
- The completion guard must reject task.complete until required evidence exists.`;

const vscodeProject = `---
name: vscode-project
description: "Open projects in VS Code from the CLI, edit files, run tests and read git diffs — keyboard/CLI only, no mouse."
allowed_tools: ["app.open", "cli.run", "file.read", "file.write", "file.edit", "file.tree", "file.search", "keyboard.combo"]
requires_connections: []
risk: "process_exec"
trigger: "open project vs code run tests fix failing tests git diff coding"
---

# VS Code Project Workflow
Use this skill for local coding tasks: inspect a repository, edit files, run tests, fix build errors, and summarize diffs.

## Process
1. Inspect the repository with file.tree and file.search before editing.
2. Read relevant files and understand local patterns.
3. Make focused file edits with file.edit/file.write or CLI-supported tooling.
4. Run the smallest relevant tests first, then broader build/test commands when needed.
5. Inspect git diff and summarize changed behavior.

## Verification
- Report commands run and their result.
- Do not complete a code change without at least a build, test, lint, or explicit reason tests could not run.
- Never click in VS Code or use mouse/cursor/screenshot automation.`;

const githubMaintainer = `---
name: github-maintainer
description: "Maintain GitHub repos via the GitHub connection: read files, list/comment issues, create branches and open PRs."
allowed_tools: ["connection.call", "approval.request", "ask_user"]
requires_connections: ["github"]
risk: "external_write"
trigger: "github repo readme pull request issue branch commit"
---

# GitHub Maintainer
Use this skill for GitHub repository maintenance through the GitHub connection: issues, PRs, branches, files, reviews, comments, and release coordination.

## Process
1. Check that the GitHub connection is configured before attempting live work.
2. Read repository, issue, PR, or file context through connection.call.
3. For writes, prepare the exact proposed action and request approval when required.
4. Create focused branches/commits/PRs or comments, then report stable URLs.

## Verification
- Read back created comments, PR metadata, branch status, or file content.
- Do not claim a GitHub write succeeded without provider confirmation.
- If auth or permissions are missing, block and ask_user.`;

const notionWorkspace = `---
name: notion-workspace
description: "Read and write Notion pages and databases via the Notion connection, with approval for writes."
allowed_tools: ["connection.call", "approval.request", "ask_user"]
requires_connections: ["notion"]
risk: "external_write"
trigger: "notion page database row update create query workspace"
---

# Notion Workspace
Use this skill for Notion pages and databases through the Notion connection.

## Process
1. Confirm the Notion connection is configured and the target workspace/page/database is clear.
2. Search/read pages or query databases before writing.
3. For creates and updates, preserve page structure and user terminology.
4. Request approval for writes when policy requires it.
5. Report the resulting page/database URL or row identifier.

## Verification
- Read the page, database row, or query result back after a write.
- If permissions are missing, block and ask_user rather than inventing access.`;

const marketingReport = `---
name: marketing-report
description: "Compile a marketing report by reading spreadsheets/CSVs and web sources, then writing a summary file."
allowed_tools: ["sheet.read", "file.read", "file.write", "browser.open", "browser.read", "browser.extract_table", "connection.call"]
requires_connections: []
risk: "local_write"
trigger: "marketing report weekly metrics summary analytics dashboard compile"
---

# Marketing Report
Use this skill to compile recurring or one-off marketing performance reports from spreadsheets, CSVs, dashboards, web pages, or connected tools.

## Process
1. Identify the reporting period, metrics, sources, and requested output format.
2. Read data through sheet.read, file.read, browser DOM tools, or connection APIs.
3. Aggregate key metrics, deltas, anomalies, and caveats.
4. Write the report with clear sections: summary, metric table, insights, risks, and next actions.
5. Keep claims tied to read source data.

## Verification
- Read the saved report back.
- Confirm required sections and key metrics are present.
- Never screenshot dashboards or rely on visual-only evidence.`;

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
