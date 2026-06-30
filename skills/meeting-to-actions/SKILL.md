---
name: "meeting-to-actions"
description: "Turn meeting notes into decisions, action items, CRM updates, follow-up drafts, tasks, and read-back evidence."
version: "1.0.0"
categories: ["office-results", "meetings", "crm", "email"]
trigger: "meeting notes follow-up crm update action items task hatarido megbeszeles jegyzet"
trigger_phrases: ["meeting notes to actions", "CRM update after meeting", "follow-up email draft", "meeting jegyzet"]
when_to_use: ["Use after calls or meetings when notes should become tasks, CRM notes, status updates, or email drafts."]
when_not_to_use: ["Do not use when the user only wants raw transcription cleanup."]
allowed_tools: ["document.read", "document.read_many", "connection.call", "email.compose", "doc.write_txt", "doc.write_docx", "approval.request", "ask_user"]
requires_connections: []
risk: "external_write"
verification_checklist: ["Read meeting notes first.", "Extract decisions, action items, owners, and due dates.", "Ask on ambiguous CRM records.", "Read back CRM/task updates and email draft evidence."]
supports_automation: true
supports_manual_run: true
---

# Meeting To Actions

## Workflow
1. Read the meeting note/transcript.
2. Extract decisions, commitments, risks, missing information, owner, due date, and next step.
3. Search CRM records; if multiple records match, ask before writing.
4. Draft CRM note/task updates and follow-up email.
5. Write only after approval when the action changes external systems.

## Verification
- Each action item must have at least task text, owner or owner unknown, and due date or due date unknown.
- CRM writes require provider read-back.
- Follow-up email must be a draft, not a sent message unless approved.
