import type { ToolRisk } from '../../control-system/types';
import type { ReferencedContext } from '../../mentions/types';

export type SkillPackageSource = 'built_in' | 'user' | 'workspace' | 'suggested' | 'imported';

export interface SkillStep {
  id: string;
  title: string;
  instruction: string;
  required: boolean;
  preferredTools: string[];
  referencedContext: ReferencedContext[];
}

export type VerificationKind =
  | 'read_back'
  | 'file_exists'
  | 'file_read_back'
  | 'connection_read_back'
  | 'sheet_values_match'
  | 'doc_read_back'
  | 'contains_text'
  | 'manual_review'
  | 'custom';

export interface VerificationCheck {
  id: string;
  title: string;
  description?: string;
  kind: VerificationKind;
  required: boolean;
  config?: Record<string, unknown>;
}

export interface SkillExample {
  id: string;
  title: string;
  userPrompt: string;
  expectedBehavior: string;
}

export interface SkillAsset {
  id: string;
  kind: 'reference' | 'script' | 'template' | 'file';
  name: string;
  uri?: string;
  content?: string;
}

export interface SkillPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  source: SkillPackageSource;
  workspaceId?: string;
  categories: string[];
  triggerPhrases: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  requiredConnections: string[];
  requiredMcpServers: string[];
  allowedTools: string[];
  riskLevel: ToolRisk;
  instructionBody: string;
  steps: SkillStep[];
  verificationChecklist: VerificationCheck[];
  examples: SkillExample[];
  assets: SkillAsset[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface SkillPackageSummary {
  id: string;
  name: string;
  description: string;
  triggerPhrases: string[];
  requiredConnections: string[];
  riskLevel: ToolRisk;
  source: SkillPackageSource;
  enabled: boolean;
}
