// Skill Builder types (Phase 2). A SkillBuilderSkill is the editable, structured
// source a user creates in the UI. The compiler turns it into the runtime
// SKILL.md / SkillManifest the existing skill runner understands — so custom
// skills flow through exactly the same execution + verification path as bundled
// ones, with no parallel system.

import type { ToolRisk } from '../../control-system/types';

export type SkillBuilderSource = 'admin_authored' | 'self_learned' | 'user' | 'workspace' | 'suggested' | 'imported';
export type SkillReviewStatus = 'draft' | 'pending_review' | 'validated_local' | 'approved' | 'deprecated' | 'blocked';
export type SkillBuilderKind = 'workflow' | 'app_profile';

export interface SkillTarget {
  appName?: string;
  domain?: string;
  urlPatterns?: string[];
  windowTitlePatterns?: string[];
  preferredBrowserProfileId?: string;
}

export interface SkillLearningMetadata {
  originTaskRunIds: string[];
  autoLearned: boolean;
  confidence: number;
  promotedAt?: string;
  lastUsedAt?: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
}

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
  status?: SkillReviewStatus;
  checksum?: string;
  approvedAt?: string;
  approvedBy?: string;
  originTaskRunId?: string;
  originAutomationId?: string;
  kind?: SkillBuilderKind;
  target?: SkillTarget;
  learning?: SkillLearningMetadata;
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
  status?: SkillReviewStatus;
  checksum?: string;
  approvedAt?: string;
  approvedBy?: string;
  originTaskRunId?: string;
  originAutomationId?: string;
  kind?: SkillBuilderKind;
  target?: SkillTarget;
  learning?: Partial<SkillLearningMetadata>;
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
