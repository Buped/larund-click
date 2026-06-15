# Workspace Onboarding (Phase 2)

A short questionnaire configures Larund for a user/workspace. Code:
`src/lib/workspaces/onboarding.ts`. UI: Coworker → Workspaces → **Guided setup**.

## Questions

1. **Workspace name**
2. **Purpose** — development / marketing / operations / admin / client / finance /
   research / custom
3. **Tools you use** — connection provider ids (google-workspace, github, notion,
   slack, hubspot, airtable, wordpress)
4. **What should Larund help with** — free-form
5. **Never without approval** — send_messages, delete_files,
   modify_production_code, publish, run_shell, spend_money
6. **Style & preferences** — free text

## Planner (pure) → `buildOnboardingPlan(answers)`

Deterministic, no I/O. Produces:
- **workspace** input (kind, autonomy, recommended connections + enabled skills).
  Autonomy tightens to `manual` when 4+ guardrails are selected.
- **starterMemories** — a workspace-purpose memory, one full-confidence
  **guardrail preference** per "never without approval" choice, and a style
  preference memory. All scoped to the workspace.
- **recommendedSkills** / **recommendedConnections** (per purpose).
- **suggestedRoleId** (per purpose, e.g. marketing → `marketing-strategist`).
- **sampleTasks** to get started.

## Apply → `applyOnboarding(answers)`

Creates the workspace and persists the scoped starter memories, then returns the
workspace + counts + the plan. The UI sets it active and arms the suggested role.

## Tests

`workspaces/__tests__/onboarding.test.ts`: purpose→skills/role/connections mapping,
guardrail + style memory seeding (guardrails are confidence 1), autonomy tightening,
and that applied memories are workspace-scoped and retrievable by the agent.

## Safety / limitations

- Onboarding only **recommends** connections; it never configures credentials.
- The user can skip onboarding and create a plain workspace instead.
- Guardrail memories are advisory to the agent; hard enforcement remains the risk
  policy + approval gate (`tools/run.ts`).
