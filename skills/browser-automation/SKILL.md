---
name: browser-automation
description: "Drive websites via the browser DOM/CDP tools (read/click/type/extract) — never the mouse or screen pixels."
allowed_tools: ["browser.open", "browser.read", "browser.click", "browser.type", "browser.key", "browser.wait", "browser.extract_table", "browser.download", "browser.upload", "ask_user"]
requires_connections: []
risk: "external_write"
trigger: "open a website, fill a form, extract data from a page, log into a web app"
---

# Browser Automation

Use when a task needs a website and there is no direct API/connection.

Workflow:
1. `browser.open` the page (uses the managed agent profile by default).
2. `browser.read` to snapshot the visible DOM/text.
3. Act with `browser.click` / `browser.type` / `browser.key` by element text or CSS selector.
4. Re-read after the UI changes. Retry a stale reference once, then re-read.
5. Use `browser.extract_table` for tabular data, `browser.download`/`upload` for files.
6. For login, 2FA, captcha or OS permission dialogs, stop and `ask_user`.

Rules:
- Never use a mouse or screen coordinates — selectors and text only.
- Don't touch the user's personal Chrome profile unless they explicitly ask (login).
- Form submits / publishing are external_write and may need approval.
