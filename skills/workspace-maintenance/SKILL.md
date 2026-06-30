---
name: "workspace-maintenance"
description: "Maintain Gmail, Drive, Notion, HubSpot, and other workspaces by detecting stale, duplicate, missing, or misfiled records."
version: "1.0.0"
categories: ["office-results", "workspace", "maintenance"]
trigger: "workspace maintenance drive notion gmail hubspot crm cleanup labels folders database karbantartas"
trigger_phrases: ["workspace maintenance", "system cleanup", "Drive cleanup", "Notion database cleanup", "CRM hygiene"]
when_to_use: ["Use for workspace hygiene, labels/folders/databases/CRM record audits, and maintenance reports."]
when_not_to_use: ["Do not perform destructive cleanup without explicit approval and backup/read-back."]
allowed_tools: ["connection.call", "document.read", "folder.scan", "file.write", "doc.write_txt", "approval.request", "ask_user"]
requires_connections: []
risk: "external_write"
verification_checklist: ["Run read-only audit before writes.", "Report proposed changes and risks.", "Write only approved changes.", "Read changed records/folders/labels back."]
supports_automation: true
supports_manual_run: true
---

# Workspace Maintenance

## Workflow
1. Inventory the target workspace surface with read-only calls.
2. Detect duplicates, missing fields, stale records, misfiled documents, unlabeled emails, or inconsistent statuses.
3. Produce a proposed maintenance plan with low-risk and approval-needed actions.
4. Apply approved non-destructive changes.
5. Read changed items back and write a maintenance report.

## Verification
- Final report must include what was checked, what changed, what was skipped, and what needs human review.
