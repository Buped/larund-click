---
name: google-docs
description: "Create, fill, read and export Google Docs through the Google Workspace connection."
allowed_tools: ["connection.call", "ask_user", "doc.write_txt", "doc.write_docx"]
requires_connections: ["google-workspace"]
risk: "external_write"
trigger: "google docs google doc document invoice számla"
---

# Google Docs
1. Use `google.docs.create` for new cloud docs.
2. Insert content with `google.docs.insert_text` or `google.docs.batch_update`.
3. Read back with `google.docs.read` before completion.
4. Export through Drive when export tooling is available.
5. If auth is missing, ask to connect Google or offer local `.docx`/`.txt` as a fallback.
