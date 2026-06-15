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
}

export interface Skill {
  manifest: SkillManifest;
  body: string;
  source: SkillSource;
  enabled: boolean;
  /** Set when frontmatter validation failed; skill is listed but unusable. */
  error?: string;
}
