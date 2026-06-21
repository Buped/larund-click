---
name: artifact-business-report
description: "Create polished business reports as local PDF/DOCX artifacts with metrics, tables, callouts, and verification."
allowed_tools: ["artifact.plan", "artifact.render_pdf", "artifact.render_docx", "artifact.verify", "artifact.preview", "document.read", "folder.scan", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "business report uzleti riport üzleti riport executive summary osszefoglalo összefoglaló"
---

# Artifact Business Report
Use this skill for business reports, executive summaries, performance reports, and decision docs.

## Process
1. Read referenced sources.
2. Use a structured model with cover, executive summary, metrics, tables, risks, and next steps.
3. Prefer `premium-dark-report` or `modern-light-report` based on the user's style request.
4. Render and verify before completion.
