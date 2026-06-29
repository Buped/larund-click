import { GENERATED_BUNDLED_SKILL_FILES } from './generated-bundled';

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

const gmailDraftAndSend = `---
name: gmail-draft-and-send
description: "Draft and send Gmail messages through the Gmail API — never a local TXT fallback. Summarize attached Google sources via API and build a real Gmail draft."
allowed_tools: ["email.compose", "connection.call", "document.read", "document.read_many", "approval.request", "ask_user"]
requires_connections: ["google-workspace"]
risk: "external_send"
trigger: "email e-mail gmail levél levelet draft piszkozat küldj írj emailt send compose reply"
---

# Gmail Draft & Send
Use this skill when the user wants to draft, compose, reply to, or send an email.
This is an API-first task. A local TXT/DOCX file is NEVER an acceptable result.

## Process
1. Identify the recipient(s), subject, and what the body must contain. The
   recipient's "@gmail.com" address does NOT mean open a browser.
2. If a Google Doc/Sheet/Slides/Drive file is attached or @mentioned, use its
   already-read API content (or document.read on the referenced input) to write the
   summary/body. Summarize from the real content, never from the file title.
3. Write the body as well-structured MARKDOWN (it renders as styled HTML): greeting,
   short scannable paragraphs, **bold** for key points/numbers, ## subheadings and
   - bullet lists where useful, a clear call-to-action and sign-off. Make it look like
   a polished business email, not a flat block of text.
4. Surface it with ONE email.compose {to, subject, body, cc?, bcc?, sources} call. This
   shows the editable, formatted email card AND creates the real Gmail draft when Gmail
   is connected. Do NOT also call google.gmail.create_draft afterwards (duplicate).
5. The card IS the deliverable — after one successful email.compose you are done
   (task.complete). The user reviews/edits and sends from the card with one click; if
   Gmail is not connected the card has a one-click "Connect Gmail" button.
6. Only call the send tool yourself if the user explicitly asked to send now:
   approval.request first, then connection.call google-workspace google.gmail.send
   {draftId from the email.compose result}. external_send approval applies.

## If Gmail is not connected
- email.compose still returns an editable card with a Connect-Gmail button —
  complete the task and tell the user they can connect + send right on the card.
- NEVER write a TXT/DOCX file and NEVER loop with ask_user to "connect then say done".

## Verification
- A successful email.compose (the editable card) satisfies "draft prepared".
- "Email sent" requires a google.gmail.send success confirmed in SENT.
- A local file, a browser page, or a title-only summary never satisfies this task.`;

const localOffice = `---
name: local-office
description: "Create/read local Excel, CSV, text and document files directly without GUI Office control."
allowed_tools: ["document.read", "doc.read", "doc.write_txt", "doc.write_docx", "sheet.read", "sheet.write", "sheet.append", "sheet.export_csv", "sheet.to_json", "sheet.format_range", "sheet.add_table", "sheet.add_chart", "file.exists"]
requires_connections: []
risk: "local_write"
trigger: "excel xlsx csv word docx txt local office libreoffice"
---

# Local Office
Use this skill for local spreadsheet, CSV, DOCX, TXT, and office-style file work when the user wants files on disk.

## Process
1. Determine the requested local format and output path.
2. For spreadsheets, use sheet.write, sheet.append, sheet.export_csv, or sheet.to_json.
3. For Excel/XLSX reports, produce a polished workbook: use .xlsx by default, write
   a main data sheet plus a summary sheet, add a native Excel Table, apply header
   styling, freeze panes, column widths, currency/percent/date formats, conditional
   fills, and add a useful chart when the request is a report/performance workbook.
   The table must visibly look styled in LibreOffice too: dark header, banded rows,
   borders, and colored KPI cells for change/risk/trend-style fields.
4. For vague report wording like "and everything like that" / "meg minden ilyesmi",
   expand the schema with business-relevant columns instead of creating a tiny grid.
5. For text/DOCX output, use doc.write_txt or doc.write_docx.
6. Avoid GUI Office automation. Opening a file is preview only, not editing.
7. If the user asked for Google Sheets or Google Docs, switch to the cloud skill instead.

## Verification
- Read spreadsheet outputs with sheet.read or sheet.to_json.
- Read document outputs with doc.read or file.read as appropriate.
- Confirm the exact file path exists before completion.`;

const documentAccounting = `---
name: document-accounting
description: "Read referenced invoices, record them into a local xlsx/csv or Google Sheet, and move processed files between bookkeeping folders."
allowed_tools: ["document.read", "document.read_many", "folder.scan", "folder.read_relevant", "sheet.write", "sheet.read", "file.exists", "file.list", "file.read", "file.mkdir", "file.move", "connection.call", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "invoice szamla accounting konyvel konyveles xlsx google sheet"
---

# Document Accounting
Use this skill when the user references invoices, receipts, folders of documents, or asks for accounting/bookkeeping extraction into a table — including end-to-end workflows that move each processed invoice between folders (e.g. Nem_lekönyvelt → Folyamatban → Lekönyvelt).

## Process
1. Read every referenced invoice with document.read or document.read_many.
2. For folders, scan first, select relevant files, then read the relevant documents.
3. Extract invoice number, issuer, customer, date, line item, net, tax, gross total, and currency.
4. Preserve uncertainty explicitly rather than inventing missing values.
5. Write the requested output: local XLSX/CSV through sheet tools or cloud Google Sheets through the Google connection.
6. If the workflow moves files between folders, do it yourself with file.move (create the destination with file.mkdir first if needed). Never ask the user to move files by hand — moving local files is something you can do. Only ask_user if the path is genuinely ambiguous or a file is missing.

## Verification
- Confirm all source files were read or report which files could not be read.
- Read the output rows back and compare row count/key totals.
- For moves, confirm the source path is gone and the destination path exists (file.exists / file.list).
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

const artifactPdfDocument = `---
name: artifact-pdf-document
description: "Create beautiful local PDF documents from structured artifact models, templates, verification, and previews."
allowed_tools: ["artifact.plan", "artifact.render_pdf", "artifact.verify", "artifact.preview", "artifact.open", "artifact.copy_to", "document.read", "folder.scan", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "pdf dokumentum riport proposal ajanlat ajánlat szamla számla one-pager letoltheto letölthető"
---

# Artifact PDF Document
Use this skill when the user asks for a local PDF, beautiful downloadable document, report, proposal, invoice, one-pager, or formatted PDF output.

## Process
1. Read referenced inputs first with document.read or folder.scan.
2. Run artifact.plan and choose the best PDF template.
3. Build a DocumentArtifactModel with cover, sections, tables, callouts, metrics, and page settings.
4. Render with artifact.render_pdf; do not use plain txt/markdown as the final artifact.
5. Verify with artifact.verify, including expected text when the user named content.

## Verification
- Confirm the PDF exists, is readable, has page count when available, and contains expected strings.
- Completion is allowed only after artifact.verify succeeds.`;

const artifactPresentation = `---
name: artifact-presentation
description: "Create local PPTX presentations/decks from structured slide models with verification."
allowed_tools: ["artifact.plan", "artifact.render_pptx", "artifact.verify", "artifact.preview", "artifact.open", "artifact.copy_to", "document.read", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "prezentacio prezentáció diavetites diavetítés slide pptx pitch deck dia"
---

# Artifact Presentation
Use this skill when the user asks for a PPTX, presentation, slide deck, pitch deck, or a specific number of slides.

## Process
1. Plan the artifact and default to 16:9 unless asked otherwise.
2. Build a PresentationArtifactModel with title, bullets, cards, timeline, comparison, quote, metrics, and closing slides.
3. Keep slides concise; prefer cards/timelines over dense bullet walls.
4. Render with artifact.render_pptx.
5. Verify with artifact.verify and match requested slide count exactly.

## Verification
- Completion requires artifact.verify with readable true and the requested slideCount.`;

const artifactWordDocument = `---
name: artifact-word-document
description: "Create editable local DOCX/Word documents from structured models with headings, tables, and verification."
allowed_tools: ["artifact.plan", "artifact.render_docx", "artifact.convert", "artifact.verify", "artifact.preview", "artifact.open", "artifact.copy_to", "document.read", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "word docx szerkesztheto szerkeszthető szerzodes szerződés dokumentacio dokumentáció"
---

# Artifact Word Document
Use this skill when the user asks for editable Word/DOCX output, contracts, project plans, or formatted editable documents.

## Process
1. Make DOCX the primary output.
2. Build a DocumentArtifactModel with headings, paragraphs, page breaks, tables, and simple callouts.
3. Render with artifact.render_docx.
4. Export PDF only when the user asks for it too, using artifact.convert if LibreOffice is available.

## Verification
- Run artifact.verify and confirm expected text is extractable.`;

const artifactInvoice = `---
name: artifact-invoice
description: "Create professional local invoice PDFs/DOCX files while avoiding invented legal-critical invoice data."
allowed_tools: ["artifact.plan", "artifact.render_pdf", "artifact.render_docx", "artifact.verify", "artifact.preview", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "szamla számla invoice dijbekero díjbekérő fizetesi bizonylat fizetési bizonylat arajanlat árajánlat"
---

# Artifact Invoice
Use this skill for invoices, test invoices, fee requests, receipts, and invoice-like offers.

## Rules
1. If real invoice data is missing, ask for it or clearly mark the output as TESZT/MINTA.
2. Never invent legally critical issuer, tax number, bank, VAT, or invoice number data for a real invoice.
3. Include line items, VAT/tax, subtotal, total, payment terms, and issuer/client blocks.
4. Verify invoice number or test marker, issuer/client, and total amount when provided.`;

const artifactBusinessReport = `---
name: artifact-business-report
description: "Create polished business reports as local PDF/DOCX artifacts with metrics, tables, callouts, and verification."
allowed_tools: ["artifact.plan", "artifact.render_pdf", "artifact.render_docx", "artifact.verify", "artifact.preview", "document.read", "folder.scan", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "business report uzleti riport üzleti riport executive summary osszefoglalo összefoglaló"
---

# Artifact Business Report
Use this skill for business reports, executive summaries, performance reports, and decision docs.

## Process
1. Read referenced sources.
2. Use a structured model with cover, executive summary, metrics, tables, risks, and next steps.
3. Prefer premium-dark-report or modern-light-report based on the user's style request.
4. Render and verify before completion.`;

const artifactProposal = `---
name: artifact-proposal
description: "Create local proposal/offer artifacts in PDF and/or DOCX from one structured source model."
allowed_tools: ["artifact.plan", "artifact.render_pdf", "artifact.render_docx", "artifact.verify", "artifact.preview", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "proposal ajanlat ajánlat offer scope timeline pricing"
---

# Artifact Proposal
Use this skill for proposals, offers, commercial documents, and scope/pricing artifacts.

## Process
1. Build one source DocumentArtifactModel.
2. Include summary, scope, deliverables, timeline, pricing table, assumptions, and next steps.
3. If PDF and Word are both requested, render both from the same source model.
4. Verify every output file separately.`;

const artifactVerification = `---
name: artifact-verification
description: "Verify local artifact files before completion: existence, readability, expected text, counts, preview, and manifest."
allowed_tools: ["artifact.verify", "artifact.preview", "artifact.list", "artifact.pdf_extract_text", "artifact.pdf_metadata", "artifact.pdf_page_count", "file.exists", "file.metadata"]
requires_connections: []
risk: "read_only"
trigger: "artifact verify ellenoriz ellenőriz preview thumbnail manifest page count slide count"
---

# Artifact Verification
Use this skill after every artifact render and before task.complete.

## Checklist
1. File exists and size is greater than zero.
2. File is readable by artifact.verify.
3. Page count or slide count is present when relevant.
4. Expected text is checked when the user provided concrete content.
5. Preview/thumbnail exists when generated.
6. Manifest appears in artifact.list.`;

const dataAnalysisAndCode = `---
name: data-analysis-and-code
description: "Run real computation on company data with isolated Python (pandas/numpy/matplotlib): statistics, correlation, trend/regression, outlier & anomaly detection, custom multi-step transforms, chart generation, bulk text/regex processing, and programmatic mapping of an existing Excel/Doc structure."
allowed_tools: ["code.execute", "code.install_package", "sheet.read", "sheet.profile", "sheet.query", "sheet.write", "sheet.format_range", "sheet.add_table", "sheet.add_chart", "document.read", "file.read", "file.write", "ask_user", "task.complete"]
requires_connections: []
risk: "process_exec"
trigger: "elemzes elemzés statisztika statisztikai diagram grafikon abra ábra python kod kód korrelacio korreláció regresszio regresszió trend szoras szórás eloszlas eloszlás kiugro kiugró anomalia anomália outlier analysis statistics correlation regression deviation distribution chart plot scatter histogram percentile anomaly"
when_not_to_use: ["egyszeru osszeg vagy osszesites", "simple sum or total use sheet.query", "mennyi az osszesen", "egy oszlop osszege"]
---

# Data Analysis & Code Execution
Use this skill when the user needs a REAL computation/analysis/transformation on
their data that the native sheet tools cannot express — statistical analysis,
correlation, trend/regression, outlier/anomaly detection, a custom multi-step
transform, a generated chart, bulk text processing with regex, simple statistical
tests, or programmatically mapping the structure of an existing Excel/Doc.

## Decision guide — pick the cheapest tool that answers the question
1. SIMPLE summary / filter / group over a table ("mennyi az összes X", "per-region
   total")? Use \`sheet.query\` FIRST — it is faster, exact, and needs no code run.
   Do NOT spin up Python for a plain sum/average/count that sheet.query computes.
2. More than that — statistics, correlation, trend/regression line, std-dev,
   outlier/anomaly detection, a custom multi-step transform, or a chart? Use
   \`code.execute\` with pandas/numpy/matplotlib.
3. LARGE table (>1000 rows): do NOT load the raw rows into your own context first.
   Pass the input by reference and write Python that reads the file itself
   (\`pandas.read_csv\`/\`read_excel\` on the input's file name) and returns ONLY the
   result — a number, a small table, or a saved chart — never the raw data.
4. Charts: save the figure as a PNG into the run directory
   (\`plt.savefig("chart.png")\`); it is harvested and shown inline in chat. Never
   return a long inline base64 string.
5. Final goal is a formatted Word/Excel/PPTX? Python does the COMPUTATION only; hand
   the result to \`sheet.write\`/\`sheet.format_range\`/\`sheet.add_table\`/\`sheet.add_chart\` (Excel) or the
   artifact.render_* engine (Word/PPTX). NEVER write the polished .xlsx/.docx/.pptx
   directly from Python — Larund already has a unified, design-token-driven engine.
   openpyxl/python-docx/python-pptx in the venv are for READING/inspecting existing
   files, not for producing the final artifact.
6. Always explain in plain language what the code did and what the result means
   BEFORE the raw code/output — the code itself is a collapsible "details" section,
   not the main answer.

## Packages
Pre-approved (auto-provisioned): pandas, numpy, openpyxl, matplotlib, python-docx,
python-pptx, PyMuPDF (fitz). Anything else is NOT installed silently — call
\`code.install_package\` (one package, approval-gated) and explain why it is needed.

## Isolation
The code runs in a throwaway sandbox folder. It cannot read/write outside that
folder except the input files you reference (they are copied in by file name).
Network is OFF unless explicitly enabled, and enabling it always asks for approval.

## Verification
- For a numeric/statistical answer, state the concrete computed value(s).
- For a chart, confirm the PNG was generated (it appears inline).
- If the goal was an Excel/Word/PPTX deliverable, verify it was produced by the
  native sheet/artifact engine, not by Python directly.`;

export const BUNDLED_SKILL_FILES: string[] = [
  dataAnalysisAndCode,
  fileOrganizer,
  browserAutomation,
  googleSheetsWeb,
  googleSheets,
  googleWorkspace,
  googleDocs,
  gmailDraftAndSend,
  localOffice,
  documentAccounting,
  taskVerification,
  vscodeProject,
  githubMaintainer,
  notionWorkspace,
  marketingReport,
  artifactPdfDocument,
  artifactPresentation,
  artifactWordDocument,
  artifactInvoice,
  artifactBusinessReport,
  artifactProposal,
  artifactVerification,
  ...GENERATED_BUNDLED_SKILL_FILES,
];
