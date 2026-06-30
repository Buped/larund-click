---
name: task-verification
description: "Before completing, verify the requested outcome actually exists with a read-back appropriate to the surface."
allowed_tools: ["file.exists", "file.list", "file.tree", "file.read", "sheet.read", "browser.read", "browser.get_state", "browser.assert_text", "browser.assert_url", "screen.verify", "connection.call"]
requires_connections: []
risk: "read_only"
trigger: "before task.complete, or when asked to confirm a result is real"
---

# Task Verification

Never claim success on the model's word alone. Prove it with a read-back that
matches the surface. The runtime completion guard enforces this independently.

Extract the expected outcome from the original goal, then verify:

- **Local files** → `file.exists` / `file.list` / `file.tree`. If you wrote a file,
  read it back. If you moved files, confirm both source and destination.
- **Local spreadsheet** → `sheet.read` and check the rows/cells are present.
- **Cloud Google Sheet** → `browser.read` / `browser.assert_text` showing the rows
  in the grid, or a Google connection `sheets.read`. A local file does NOT count.
- **Browser / webapp** → after a change, `browser.read` and `browser.assert_text` /
  `browser.assert_url`, AND a visual `screen.verify` (surface "browser") confirming
  the rendered screen shows the change. Opening the page is not proof of a change.
- **Desktop app** → `screen.verify` (surface "desktop") confirming the app window
  visibly shows the requested outcome.
- **Connection** → use the call's success result and a read-back where available.

For browser/desktop-app tasks the runtime BLOCKS completion until `screen.verify`
returns done:true with no blockers, taken AFTER the last change.

If verification fails, keep working — do not complete. If a login/CAPTCHA/permission
wall blocks verification, `ask_user` and resume; never mark the task complete.

## Visual self-check (screen.verify)
- `screen.verify` captures a screenshot of the current surface and a vision model judges it against your success criteria, returning `{done, progress, metCriteria, unmetCriteria, blockers, nextStepHint}`.
- It is PERCEPTION ONLY — never coordinates or clicks. You still act through structured tools (DOM/CDP/API/keyboard); never click by pixel.
- Pass the concrete success criteria you are checking (e.g. "Row for ACME is visible in the grid", "The post shows as published"). If `done:false`, do the remaining work and re-verify; on a blocker (login/CAPTCHA/permission/error dialog), `ask_user`, then resume and re-verify.
- It does NOT replace structured read-backs for files/sheets/email — those still apply.

## Action shape (exact JSON)
{"action":"screen.verify","surface":"browser","criteria":["<visible success condition>"],"question":"<optional focus>"}
