---
name: "data-transfer-ops"
description: "Copy structured data between systems with schema mapping, conflict handling, write-back, and target verification."
version: "1.0.0"
categories: ["office-results", "data", "integrations"]
trigger: "copy data transfer sync migrate masol masold atmasol atmasold adat rendszerbol rendszerbe crm sheets notion hubspot"
trigger_phrases: ["copy data between systems", "system to system copy", "adat masolas", "masold at", "HubSpot to Sheets", "Notion to CRM"]
when_to_use: ["Use when data must move from one system/file/table to another."]
when_not_to_use: ["Do not use for one-off prose summaries without target writes."]
allowed_tools: ["connection.call", "sheet.read", "sheet.write", "sheet.append", "sheet.update_cells", "sheet.to_json", "file.write", "approval.request", "ask_user"]
requires_connections: []
risk: "external_write"
verification_checklist: ["Read source data and infer source schema.", "Preview target mapping before risky writes.", "Use ask_on_conflict as the default conflict policy.", "Read target rows/records back and compare counts/key fields."]
supports_automation: true
supports_manual_run: true
---

# Data Transfer Ops

Default conflict policy is `ask_on_conflict`.

## Workflow
1. Read source schema and sample rows.
2. Read target schema/metadata when available.
3. Build a field mapping with required, optional, and unknown fields.
4. Dry-run the mapped rows and ask before ambiguous overwrites.
5. Write or append the mapped data.
6. Read target data back and produce a mismatch report.

## Verification
- Completion requires source count and target read-back count.
- External writes require approval unless the active automation policy explicitly allows them.
