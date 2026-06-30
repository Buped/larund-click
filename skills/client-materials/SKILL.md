---
name: "client-materials"
description: "Create client-ready proposals, offers, reports, summaries, and follow-up materials from briefs and source files."
version: "1.0.0"
categories: ["office-results", "client", "documents", "sales"]
trigger: "proposal offer ajanlat riport report client material ugyfelanyag osszefoglalo"
trigger_phrases: ["proposal pack", "client report", "ajanlat keszites", "ugyfelanyag", "executive summary"]
when_to_use: ["Use for client-facing materials such as proposals, reports, offers, summaries, and follow-up packs."]
when_not_to_use: ["Do not use for raw data cleanup unless the final output is a client material."]
allowed_tools: ["document.read", "document.read_many", "folder.scan", "connection.call", "artifact.plan", "artifact.render_pdf", "artifact.render_docx", "artifact.verify", "artifact.preview", "email.compose", "ask_user"]
requires_connections: []
risk: "local_write"
verification_checklist: ["Read source brief/materials first.", "Render the requested artifact type.", "Run artifact.verify with expected text.", "Draft email only when requested; send requires approval."]
supports_automation: true
supports_manual_run: true
---

# Client Materials

## Workflow
1. Read the client brief, project folder, meeting notes, or email context.
2. Identify audience, goal, offer, constraints, missing questions, and tone.
3. Build a structured artifact model for PDF/DOCX.
4. Include summary, scope, deliverables, timeline, pricing or metrics, assumptions, risks, and next steps when relevant.
5. Verify the artifact and optionally draft a delivery email.

## Verification
- Artifact verify must pass before completion.
- Concrete client names, prices, and dates must come from source material or be marked as assumptions.
