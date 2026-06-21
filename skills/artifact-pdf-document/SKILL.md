---
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
1. Read referenced inputs first with `document.read` or `folder.scan`.
2. Run `artifact.plan` and choose the best PDF template.
3. Build a `DocumentArtifactModel` with cover, sections, tables, callouts, metrics, and page settings.
4. Render with `artifact.render_pdf`; do not use plain TXT/Markdown as the final artifact.
5. Verify with `artifact.verify`, including expected text when the user named content.

## Verification
- Confirm the PDF exists, is readable, has page count when available, and contains expected strings.
- Completion is allowed only after `artifact.verify` succeeds.
