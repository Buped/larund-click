---
name: browser-automation
description: "Drive websites via the browser DOM/CDP tools (read/click/type/paste/extract) — never the mouse or screen pixels."
allowed_tools: ["browser.open", "browser.read", "browser.get_state", "browser.click", "browser.type", "browser.key", "browser.shortcut", "browser.paste", "browser.assert_text", "browser.assert_url", "browser.wait", "browser.extract_table", "browser.download", "browser.upload", "clipboard.set", "ask_user"]
requires_connections: []
risk: "external_write"
trigger: "open a website, fill a form, extract data from a page, log into a web app"
---

# Browser Automation

Use when a task needs a website and there is no direct API/connection.

Lifecycle (do not skip steps):
1. `browser.open` the page (uses the managed agent profile by default).
2. `browser.wait` then `browser.read` / `browser.get_state` to snapshot URL, title,
   focused element, inputs, buttons, and `STATE_HINTS`.
3. Check the page state:
   - `STATE_HINTS: login_required / captcha / permission_required` → **manual blocker**.
   - interactive inputs/buttons present → the app is ready to act on.
4. Act with `browser.click` / `browser.type` (by element text or CSS selector).
5. **Re-read after every state-changing action** — never assume it worked.
6. Verify with `browser.assert_text` / `browser.assert_url` before completing.
7. Use `browser.extract_table` for tabular data; `browser.download`/`upload` for files.

Rules:
- Never use a mouse or screen coordinates — selectors and text only.
- Opening a page is NOT task completion unless the user only asked to open it.
- `browser.type` errors with `AMBIGUOUS` when several inputs match — pick a more
  specific target. Never let data land in a title/search box by accident.
- For login, 2FA, CAPTCHA or permission walls: do not fail and do not complete.
  `ask_user` to resolve it ("…then reply: kész") and resume the SAME task.
- Form submits / publishing are external_write and may need approval.
