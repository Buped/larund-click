---
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
2. Build a `DocumentArtifactModel` with headings, paragraphs, page breaks, tables, and simple callouts.
3. Render with `artifact.render_docx`.
4. Export PDF only when the user asks for it too, using `artifact.convert` if LibreOffice is available.

## Action shapes (exact JSON)
{"action":"artifact.render_docx","title":"<title>","template_id":"<optional>","output_name":"<optional.docx>","model":{"title":"<title>","language":"hu","format":"docx","page":{"size":"A4","orientation":"portrait"},"sections":[]}}
{"action":"artifact.convert","from_path":"<path>","to":"pdf","output_name":"<optional>"}
{"action":"artifact.verify","path":"<path>","expected_text":["<text>"],"expected_kind":"docx"}

## Verification
- Run `artifact.verify` and confirm expected text is extractable.
