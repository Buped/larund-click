---
name: "document-ops"
description: "Find, read, summarize, prepare, and export documents across local files, Drive, Google Docs, and Notion."
version: "1.0.0"
categories: ["office-results", "documents", "google-workspace", "notion"]
trigger: "document docs drive notion search summarize osszefoglal dokumentum elokeszit"
trigger_phrases: ["document search", "document summary", "drive document prep", "notion page summary", "dokumentum kereses"]
when_to_use: ["Use for finding, reading, summarizing, preparing, exporting, or consolidating documents."]
when_not_to_use: ["Do not use when the user specifically wants only email, CRM, or spreadsheet updates."]
allowed_tools: ["document.read", "document.read_many", "folder.scan", "folder.read_relevant", "connection.call", "doc.write_txt", "doc.write_docx", "artifact.plan", "artifact.render_pdf", "artifact.render_docx", "artifact.verify", "ask_user"]
requires_connections: []
risk: "local_write"
verification_checklist: ["Read each referenced source before summarizing.", "Keep a source list.", "Read back the prepared document or artifact.", "For cloud docs, read provider metadata or content after writing."]
supports_automation: true
supports_manual_run: true
---

# Document Ops

Use this skill for document retrieval and preparation, whether local or cloud.

## Workflow
1. Resolve the requested source: local folder/file, Drive, Google Docs, or Notion.
2. Search first, then read the exact matching documents.
3. Separate facts, conclusions, and unknowns.
4. Produce the requested output as Google Doc, DOCX, PDF, or concise local note.
5. Include source names/links and any confidence caveats.

## Verification
- Local output requires file/artifact read-back.
- Google Docs output requires `google.docs.read` or export proof.
- Notion output requires page/block read-back.
