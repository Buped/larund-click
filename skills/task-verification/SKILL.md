---
name: task-verification
description: "Before completing, verify the requested outcome actually exists with a read-back appropriate to the surface."
allowed_tools: ["file.exists", "file.list", "file.tree", "file.read", "sheet.read", "browser.read", "browser.get_state", "browser.assert_text", "browser.assert_url", "connection.call"]
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
  `browser.assert_url`. Opening the page is not proof of a change.
- **Connection** → use the call's success result and a read-back where available.

If verification fails, keep working — do not complete. If a login/CAPTCHA/permission
wall blocks verification, `ask_user` and resume; never mark the task complete.
