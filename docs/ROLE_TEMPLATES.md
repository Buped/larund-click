# Role / Subagent Templates (Phase 2 foundation)

A **role** shapes how Larund approaches a task: its default skills/tools/
connections, memory scope, an optional autonomy override, and system instructions.
This is the **foundation only** — no parallel/multi-agent orchestration yet. A role
affects prompt composition and skill ranking for a single run. Code: `src/lib/roles/`.

## Model

`RoleTemplate`: id, name, description, categories, defaultSkills, defaultTools,
defaultConnections, memoryScope, `riskPolicyOverride?`, systemInstructions.

## Built-in roles

Developer · Marketing Strategist · Researcher · Data Analyst · Document/Office
Operator · QA Verifier · Admin Assistant · Client Success Assistant.

(QA Verifier is intended for reuse by the completion guard/verifier in a later
phase; it carries a `manual` autonomy override.)

## How a role influences a run

- `renderRolePrompt(role)` adds an `## Active role: <name>` block with the role's
  system instructions to the prompt.
- Skill ranking is biased: `rankSkillsForTask` accepts `boostSkillNames` (the
  role's default skills, +2.5) and `boostCategories` (+1), so the role visibly
  changes which skills surface even on weak lexical match.
- The selected `roleId` is recorded on the TaskRun.

## Selecting a role

UI: Coworker → **Roles** → "Use role" sets `localStorage.active_role_id`;
`chat.tsx` passes it as `RunOptions.roleId`. Onboarding also arms a suggested role.

## Tests

`roles/__tests__/roles.test.ts`: 8 typed roles, lookup, prompt rendering, and that
a selected role changes the top-ranked skill for a neutral task.

## Safety / limitations

- A role never grants new capabilities — only defaults/biases over existing
  no-mouse tools and skills.
- `riskPolicyOverride` is advisory in Phase 2 (UI may apply it); the approval gate
  is unchanged.
- No subagent spawning / parallel execution yet (Phase 3+).
