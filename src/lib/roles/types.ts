// Role / Subagent templates foundation (Phase 2). A RoleTemplate shapes how the
// agent approaches a task: default skills/tools/connections, memory scope, an
// optional risk-policy override, and system instructions injected into the prompt.
//
// This is the FOUNDATION only — no parallel/multi-agent orchestration yet. A role
// affects prompt composition and skill ranking for a single run.

import type { AutonomyMode } from '../workspaces/types';

export interface RoleTemplate {
  id: string;
  name: string;
  description: string;
  categories: string[];
  defaultSkills: string[];
  defaultTools: string[];
  defaultConnections: string[];
  memoryScope: 'global' | 'workspace' | 'project';
  /** Optional autonomy override the role suggests (UI may apply it). */
  riskPolicyOverride?: AutonomyMode;
  systemInstructions: string;
}
