---
name: "recurring-admin"
description: "Turn recurring admin work into safe automations with triggers, setup bindings, approvals, run history, and verification."
version: "1.0.0"
categories: ["office-results", "automation", "admin"]
trigger: "recurring admin automation ismertlodo adminisztracio weekly daily scheduler workflow"
trigger_phrases: ["recurring admin", "ismetlodo adminisztracio", "make this weekly", "daily admin brief"]
when_to_use: ["Use when the user wants a recurring admin task, scheduled brief, checklist, or automation."]
when_not_to_use: ["Do not execute broad recurring writes without setup verification and approval policy."]
allowed_tools: ["workflow.start", "connection.call", "file.write", "file.read", "doc.write_txt", "approval.request", "ask_user"]
requires_connections: []
risk: "local_write"
verification_checklist: ["Define trigger, inputs, outputs, owner, and safety policy.", "Create or reference durable setup bindings.", "Record approval points.", "Run a test or produce a verified blueprint."]
supports_automation: true
supports_manual_run: true
---

# Recurring Admin

## Workflow
1. Convert the user's repeated task into a repeatable workflow.
2. Define trigger: manual, schedule, folder watch, webhook, or connection event.
3. Define setup bindings: local folder, Google Sheet/Doc, Drive folder, Notion database, CRM view, or URL.
4. Set safety policy: external sends ask, destructive actions block or strong ask.
5. Create verification checks and run a test when possible.

## Verification
- A recurring workflow is not complete until it has a trigger, input mapping, output target, safety policy, and verification checklist.
