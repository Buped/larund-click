---
name: "microtask-capture"
description: "Capture repeated 5-15 minute digital tasks into reusable workflow templates and candidate skills after verified success."
version: "1.0.0"
categories: ["office-results", "automation", "learning"]
trigger: "microtask small task reusable workflow learn task 5 minutes 15 minutes apro digitalis feladat"
trigger_phrases: ["turn this into workflow", "microtask capture", "learn this task", "apro digitalis feladat"]
when_to_use: ["Use when a one-off small task should become a reusable workflow or skill suggestion."]
when_not_to_use: ["Do not auto-save a learned workflow without review."]
allowed_tools: ["workflow.start", "file.write", "file.read", "ask_user"]
requires_connections: []
risk: "local_write"
verification_checklist: ["Use evidence from a successful run.", "Capture trigger, inputs, steps, tools, approvals, outputs, and verification.", "Save only as draft/review candidate unless the user explicitly approves."]
supports_automation: true
supports_manual_run: true
---

# Microtask Capture

## Workflow
1. Identify the repeated task pattern and why it matters.
2. Use completed task evidence when available; otherwise ask for the missing context.
3. Draft a reusable workflow: trigger, inputs, ordered steps, tools, approvals, blockers, outputs, verification.
4. Draft skill metadata only when the pattern is reusable across tasks.
5. Mark the result as a review candidate.

## Verification
- The captured workflow must be implementable without hidden decisions.
- Learned workflows are draft-only until reviewed.
