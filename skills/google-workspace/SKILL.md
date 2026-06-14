---
name: google-workspace
description: "Use Google Workspace through API-first connection tools; browser fallback only when explicitly needed."
allowed_tools: ["connection.call", "browser.open", "browser.read", "browser.wait", "ask_user"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google workspace google drive google sheets google docs gmail calendar"
---

# Google Workspace
1. Prefer `connection.call` with `google-workspace` tools.
2. If auth is missing, ask the user to connect Google Workspace or offer a local file fallback when acceptable.
3. Never satisfy a Google cloud document request with only a local file.
4. Verify every create/write by reading metadata or values/content back.
5. Browser fallback must use DOM/read-back only; no mouse or visual clicking.
