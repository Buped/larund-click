# Skill Authoring Guide

A good Larund skill is action-oriented, surface-specific, and verifiable.

## Minimum SKILL.md

```md
---
name: example-skill
description: "What this skill does and which target surface it uses."
allowed_tools: ["file.read", "file.write", "file.exists"]
requires_connections: []
risk: "local_write"
trigger: "example trigger words"
when_to_use: ["Use when the task needs this workflow."]
when_not_to_use: ["Do not use when a different target surface was requested."]
verification_checklist: ["Read back the result before task.complete."]
---

# Example Skill
1. Read the real inputs.
2. Make the requested change.
3. Read back the result.
```

## Rules

- Do not include mouse, cursor, screenshot, OCR-click, coordinate, or pixel workflows.
- Declare every tool the skill may use.
- Declare every required connection or MCP server.
- Use a narrow trigger set; avoid “always use this skill” language.
- Add when-not-to-use guidance for overlapping skills.
- For write/external work, include read-back verification.
- If auth, CAPTCHA, permissions, or missing tools block the task, ask the user or report blocked status.

## Risk Levels

Use `read_only`, `local_write`, `external_read`, `external_write`, `external_send`, `destructive`, `credential_access`, or `process_exec`.

## Testing

Add parser tests for frontmatter, router tests for task selection, runtime tests for `skill.run` context, completion-guard tests for evidence, and UI tests when changing the catalog surface.
