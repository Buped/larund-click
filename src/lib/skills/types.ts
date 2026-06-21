import type { ToolRisk } from '../control-system/types';

export type SkillSource = 'workspace' | 'project' | 'user' | 'bundled';

export interface SkillManifest {
  name: string;
  description: string;
  allowed_tools: string[];
  requires_connections: string[];
  risk: ToolRisk;
  /** Optional natural-language trigger hint used for relevance matching. */
  trigger?: string;
  // ── Optional rich metadata (Phase 1). Absent in legacy bundled skills; the
  //    rich-manifest layer fills sensible defaults so older skills keep working.
  version?: string;
  categories?: string[];
  verification_checklist?: string[];
  when_to_use?: string[];
  when_not_to_use?: string[];
  required_mcp_servers?: string[];
  enabled_by_default?: boolean;
  license?: string;
  author?: string;
  category?: string;
  tags?: string[];
  updated?: string;
  status?: 'pending_review' | 'reviewed' | 'enabled' | 'disabled' | 'blocked' | 'deprecated';
  origin_repo?: string;
  origin_path?: string;
  source?: string;
  supports_automation?: boolean;
  supports_manual_run?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Skill {
  manifest: SkillManifest;
  body: string;
  source: SkillSource;
  enabled: boolean;
  /** Set when frontmatter validation failed; skill is listed but unusable. */
  error?: string;
}

export interface MissingRequirement {
  kind: 'tool' | 'connection' | 'mcp_server' | 'status';
  id: string;
  reason: string;
}

export interface SkillReference {
  name: string;
  path?: string;
  kind: 'reference' | 'script' | 'template' | 'example';
}

export interface SkillTemplate {
  name: string;
  path?: string;
}

export interface VerificationCheck {
  id: string;
  title: string;
  required: boolean;
}

export interface SkillRuntimeContext {
  skillId: string;
  name: string;
  version: string;
  body: string;
  allowedTools: string[];
  requiredConnections: string[];
  requiredMcpServers: string[];
  risk: import('../control-system/types').ToolRisk;
  verificationChecklist: VerificationCheck[];
  references: SkillReference[];
  templates: SkillTemplate[];
  missingRequirements: MissingRequirement[];
}
