# Workspaces

A **workspace** is the main customization boundary. A user can have many:
Personal, Company, Client A, Development, Marketing, Finance, Operations, …

Switching workspace re-shapes the agent's system prompt and the surfaces it
operates on. Code: `src/lib/workspaces/`.

## Model

```ts
Workspace {
  id; userId; name; description?;
  kind: 'personal' | 'company' | 'client' | 'project' | 'custom';
  rootPaths: WorkspaceRoot[];          // local folders, repos, drive folders, urls
  connectedProviderIds: string[];      // connections enabled here
  enabledSkillIds: string[];           // skills enabled here ([] = default set)
  memoryScope: 'workspace';
  autonomyMode: 'manual' | 'semi' | 'full';
  defaultModelId?;
  createdAt; updatedAt; archivedAt?;
}
WorkspaceRoot { id; kind; label; uri; enabled; metadata? }
```

## Store API (`store.ts`)

`createWorkspace`, `getWorkspace`, `updateWorkspace`, `archiveWorkspace`,
`deleteWorkspace`, `listWorkspaces`, `getDefaultWorkspace`, `setActiveWorkspace`,
`getActiveWorkspaceId`, `resolveActiveWorkspace`.

- **Default workspace** is auto-created on first access (`getDefaultWorkspace`) so the
  agent always has a context — existing tasks keep working with no workspace chosen.
- **Active workspace** is session-scoped (in memory) and re-resolves to default on
  restart. The UI also persists the chosen id in `localStorage('active_workspace_id')`,
  which `chat.tsx` passes as `runAgentLoop(..., { workspaceId })`.

## Agent loop integration

`buildCoworkerPromptContext` resolves the workspace and injects a **compact** summary
(`renderWorkspaceSummary`): name/kind, enabled roots, enabled connections, enabled
skills, autonomy mode, preferred model. The workspace's primary local folder becomes
the agent working dir when set. No raw data is dumped into the prompt.

## UI

Coworker → **Workspaces** tab: list, create, set active, add a root, archive, and pick
autonomy mode (manual / semi / full).

## Autonomy modes

- `manual` — ask before every write/external action.
- `semi` — auto for low-risk, approval for risky/external (default; today's behavior).
- `full` — act autonomously within the risk policy.

Autonomy feeds the existing `RiskPolicy`/approval system; it does not bypass approvals
for destructive/external-send actions.
