---
name: artifact-proposal
description: "Create local proposal/offer artifacts in PDF and/or DOCX from one structured source model."
allowed_tools: ["artifact.plan", "artifact.render_pdf", "artifact.render_docx", "artifact.verify", "artifact.preview", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "proposal ajanlat ajánlat offer scope timeline pricing"
---

# Artifact Proposal
Use this skill for proposals, offers, commercial documents, and scope/pricing artifacts.

## Process
1. Build one source `DocumentArtifactModel`.
2. Include summary, scope, deliverables, timeline, pricing table, assumptions, and next steps.
3. If PDF and Word are both requested, render both from the same source model.
4. Verify every output file separately.
