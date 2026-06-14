# Skills

Skills are reusable workflow instructions in `SKILL.md` files (OpenClaw style).

## Format

```markdown
---
name: file-organizer
description: "Organize files using deterministic file tools with approvals."
allowed_tools: ["file.*", "approval.request"]
requires_connections: []
risk: "local_write"
trigger: "organize sort clean rename files folders"
---

# File Organizer
1. Inspect …
2. Propose a plan …
```

Frontmatter is parsed by `src/lib/skills/frontmatter.ts` (validates `name`,
`description`, and the `risk` enum). The markdown body is the workflow.

## Loading & precedence

`mergeSkills` resolves duplicates by name with precedence:

1. workspace skills — `<workspace>/skills`
2. project skills — `<workspace>/.agents/skills`
3. user skills — `~/.larund/skills`
4. bundled skills — app-shipped (`/skills`, mirrored in `skills/bundled.ts`)

Only **metadata** is always available; a skill's full body is injected into the
prompt when it is run (`skill.run`) or relevant (`findRelevantSkill`).

## Bundled skills

- `file-organizer`
- `browser-automation`
- `vscode-project`
- `github-maintainer`
- `notion-workspace`
- `marketing-report`

## Running

`{"action":"skill.run","skill":"file-organizer","input":{}}` loads the skill's
allowed-tools and body so the model follows the workflow. Invalid frontmatter
leaves the skill listed but disabled with an `error`.
