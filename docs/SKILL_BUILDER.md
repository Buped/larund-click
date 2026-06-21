# Skill Builder (Phase 2)

Create, edit, test and install workspace-specific skills without hand-writing
`SKILL.md`. Custom skills compile into the **same** runtime format as bundled
skills, so they use the identical execution + verification + approval path.
Code: `src/lib/skills/builder/`.

## Data model

`SkillBuilderSkill` (`types.ts`): name, version, description, workspaceId, source
(`user | workspace | suggested | imported`), triggerPhrases, categories,
whenToUse/whenNotToUse, requiredConnections, requiredMcpServers, allowedTools,
riskLevel, inputSchema/outputSchema, `steps: SkillStep[]`,
`verificationChecklist: VerificationCheck[]`, fallbackStrategy, examplePrompts,
enabled.

## Compiler

`compileToMarkdown(skill)` emits frontmatter (name, description, version,
allowed_tools, requires_connections, required_mcp_servers, risk, categories,
trigger, when_to_use/when_not_to_use, verification_checklist, enabled_by_default)
plus a body (Steps, Verification, Fallback). `compileToSkill(skill)` runs that
through the existing parser/loader, mapping source to `workspace`/`user`.

`validateBuilderSkill(skill, knownTools)` checks required fields, valid risk,
**rejects mouse/visual tools**, warns on unknown tools, and confirms the compiled
markdown parses.

## How the agent selects a custom skill

`loadAllSkillsAsync(userId, workspaceId)` merges bundled + enabled custom skills.
`mergeSkills` precedence is `bundled < user < workspace`, so a workspace skill
**overrides/ranks above** a bundled one with the same name. `run-context` ranks
them with `rankSkillsForTask` (role-biased) and the runner (`createSkillRunner`
scoped to the workspace) loads custom skills fresh each `skill.run`.

## Suggestion from repeated tasks

`suggestSkillsFromTasks(tasks)` (`suggester.ts`) clusters similar tasks in the
same workspace (token similarity). A cluster of **2+** yields a `source:'suggested'`
draft (disabled), with steps/tools/risk inferred from the shared tool sequence.
Shown in **Coworker → Skills → Suggested skills**; install or delete.

## Testing a skill (non-destructive)

`dryRunSkill(skill, { availableConnectionIds, prompt })` (`test-runner.ts`):
validates, flags missing connections + unknown tools, renders the plan, and
returns `requiresApprovalToExecute: true` — it **never executes**. Real execution
goes through the normal approval-gated agent loop.

## UI wizard

Coworker → Skills → **+ New skill**: name/goal → trigger phrases → allowed tools →
required connections → risk → steps (`Title: instruction` per line) → verification
checklist → Save & install. Each custom skill row supports Test / Enable-Disable /
Delete.

## Tests

`builder/__tests__/builder.test.ts`: compiler output + parse, mouse-tool rejection,
unknown-tool warnings, duplicate-name rejection, workspace scoping, custom-skill
ranking + runtime inclusion, disabled exclusion, dry-run, suggestion thresholds.

## Safety / limitations

- No-mouse enforced at validate time.
- No arbitrary code execution; a skill is instructions + an allowed-tool list.
- `inputSchema`/`outputSchema` are stored but not yet enforced at runtime.
- Skill versioning is a simple patch bump on edits to steps/tools/verification.
## v2 Authoring Notes

Builder-created skills compile to `SKILL.md` and run through the same parser, router, `skill.run`, allowed-tool gate, and completion guard as bundled skills. Authors should declare `when_to_use`, `when_not_to_use`, `allowed_tools`, required connections/MCP servers, risk, and a verification checklist. See `docs/SKILL_AUTHORING_GUIDE.md`.
