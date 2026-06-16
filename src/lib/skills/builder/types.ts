// Skill Builder types (Phase 2). A SkillBuilderSkill is the editable, structured
// source a user creates in the UI. The compiler turns it into the runtime
// SKILL.md / SkillManifest the existing skill runner understands — so custom
// skills flow through exactly the same execution + verification path as bundled
// ones, with no parallel system.

import type { ToolRisk } from '../../control-system/types';

export type SkillBuilderSource = 'user' | 'workspace' | 'suggested' | 'imported';

export interface SkillStep {
  id: string;
  title: string;
  instruction: string;
  preferredTools: string[];
  required: boolean;
  verificationHint?: string;
}

export type VerificationKind =
  | 'read_back'
  | 'assert_text'
  | 'file_exists'
  | 'connection_read'
  | 'test_run'
  | 'manual_review'
  | 'custom';

export interface VerificationCheck {
  id: string;
  title: string;
  description: string;
  kind: VerificationKind;
  required: boolean;
  config?: Record<string, unknown>;
}

export interface SkillBuilderSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  userId: string;
  workspaceId?: string;
  source: SkillBuilderSource;
  /** Long-form markdown instructions the agent loads in full via skill.run. */
  instructionBody?: string;
  triggerPhrases: string[];
  categories: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  requiredConnections: string[];
  requiredMcpServers: string[];
  allowedTools: string[];
  riskLevel: ToolRisk;
  inputSchema?: unknown;
  outputSchema?: unknown;
  steps: SkillStep[];
  verificationChecklist: VerificationCheck[];
  fallbackStrategy: string;
  examplePrompts: string[];
  exampleRuns: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillBuilderInput {
  userId: string;
  workspaceId?: string;
  name: string;
  description: string;
  source?: SkillBuilderSource;
  instructionBody?: string;
  triggerPhrases?: string[];
  categories?: string[];
  whenToUse?: string[];
  whenNotToUse?: string[];
  requiredConnections?: string[];
  requiredMcpServers?: string[];
  allowedTools?: string[];
  riskLevel?: ToolRisk;
  steps?: SkillStep[];
  verificationChecklist?: VerificationCheck[];
  fallbackStrategy?: string;
  examplePrompts?: string[];
  enabled?: boolean;
}

export type SkillBuilderPatch = Partial<Omit<SkillBuilderSkill, 'id' | 'userId' | 'createdAt'>>;
