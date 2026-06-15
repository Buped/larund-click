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

## Phase 1 — Rich manifests, ranking & workspace scoping

The legacy bundled `SKILL.md` files (name/description/allowed_tools/
requires_connections/risk/trigger) are unchanged and still load. A purely additive
**rich-manifest layer** (`src/lib/skills/manifest.ts`) derives a product-grade view:

```ts
RichSkillManifest {
  id;            // `${source}:${name}`, e.g. "bundled:file-organizer"
  name; version; // version defaults to 1.0.0 when absent
  description; trigger[]; categories[];      // categories inferred when undeclared
  allowedTools[]; requiredConnections[]; requiredMcpServers[];
  risk;
  verificationChecklist[];                    // sensible default by risk when absent
  whenToUse[]; whenNotToUse[];
  enabledByDefault; source;                   // bundled | workspace | user | marketplace
}
```

Optional frontmatter fields are now parsed too: `version`, `categories`,
`verification_checklist`, `when_to_use`, `when_not_to_use`, `required_mcp_servers`,
`enabled_by_default`.

**Ranking** (`src/lib/skills/ranking.ts`) is workspace-aware:
- `isSkillEnabled` respects a workspace's `enabledSkillIds` (empty = `enabledByDefault`).
- `rankSkillsForTask` scores by trigger/name/category/description overlap and
  **flags + de-prioritizes** skills whose required connection is not available.
- `renderRelevantSkills` emits a compact "Relevant skills" prompt block (top 4) — only
  relevant, workspace-enabled skills, never the whole library.

`skill.run` behavior is unchanged. UI: Coworker → **Skills** tab lists every skill with
risk, version, categories, allowed tools and required connections.
