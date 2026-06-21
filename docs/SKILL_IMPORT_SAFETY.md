# Skill Import Safety

External skills are never executed raw. The Claude skills import path adapts markdown into Larund format, marks it `pending_review`, and statically validates it before use.

## Tools

- `scripts/adapt-claude-skill.ts <source SKILL.md> [target dir]`
- `scripts/import-claude-skills.ts <cloned claude-skills root> [target root]`
- `scripts/validate-skills.ts [skills root]`

Script-like assets (`.py`, `.sh`, `.ps1`, `.bat`, `.cmd`, `.js`, `.ts`) are copied into `scripts_quarantine/` and are reference material only. They are not runtime tools and receive no credentials.

## Tool Mapping

Claude tool names are converted only as adaptation hints:

- `Bash` -> `cli.run`
- `Read` -> `file.read`
- `Write` -> `file.write`
- `Edit` -> `file.edit`
- `Grep` / `Glob` -> `file.search`
- `WebFetch` -> `browser.read`
- `WebSearch` -> `browser.open/browser.read`
- `TodoWrite` -> `workflow.status`

If no Larund equivalent exists, the importer warns or omits the tool. It never invents fake tools.

## Reject Conditions

Imports are blocked for mouse/cursor/screenshot/pixel instructions, credential exfiltration, prompt injection such as “ignore previous instructions,” raw external tool requests, unjustified sensitive file access, or risky skills without verification checklists.

## Warning Conditions

Warnings are emitted for persona-heavy/generic descriptions, duplicate skill names, missing when-to-use/when-not-to-use guidance, external scripts, undeclared connection needs, and broad body text.

## Review States

Imported skills start as `pending_review`. Human or automated review can move them to `reviewed`, `enabled`, `disabled`, `blocked`, or `deprecated`.
