# Operator acceptance scenarios

Larund Click remains a no-mouse operator. These scenarios must be handled through CLI, files, browser DOM, connections, skills and workflows only.

## A. Referenced invoices to local accounting XLSX

Expected evidence:
- `document.read` or automatic reference preflight reads both invoice files.
- `sheet.write` creates the `.xlsx`.
- `sheet.read` reads the output back before `task.complete`.

## B. Referenced invoice folder to Google Sheet

Expected evidence:
- `folder.scan` inventories the folder.
- `folder.read_relevant` or `document.read` reads invoice files.
- `connection.call` uses `google.sheets.create` and `google.sheets.write_values`.
- `google.sheets.read_values` verifies the rows.
- Missing auth returns `missing_google_workspace_auth`; no fake completion.

## C. Google Docs invoice creation

Expected evidence:
- `google.docs.create` creates the doc.
- `google.docs.insert_text` or `google.docs.batch_update` writes content.
- `google.docs.read` verifies content.
- Missing auth asks for connection setup or a local `.docx`/`.txt` fallback.

## D. Autonomy modes

Expected behavior:
- Manual: every risk class asks.
- Semi-automatic: read-only and local low-risk operations run; external writes ask.
- Full autonomous: configured writes run, while destructive, external send and credential access still ask.

## E. Chat reference

Expected evidence:
- File/folder/URL references are stored as `DocumentReference[]`.
- Agent loop receives structured references.
- File references are read before answer generation; folder references are scanned first.

## F. Browser blocker

Expected evidence:
- `browser.open` alone is not enough for create/fill tasks.
- `browser.read`/`browser.get_state` detects login/captcha/permission blockers.
- The agent asks the user for handoff and resumes the same task.

## Current limitations

- DOCX/PDF/PPTX native text extraction is metadata-only in this build; text extraction is scaffolded for a native reader.
- `doc.write_docx` preserves content as a scaffold file, but full OOXML packaging is not implemented yet.
- Google Drive upload/export/move are scaffolded; Sheets and Docs create/write/read have mockable API paths and live API paths when an OAuth access token is configured.
- The local reference picker uses the Tauri dialog plugin if present; otherwise it falls back to path/URL prompts.
