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
}

export interface Skill {
  manifest: SkillManifest;
  body: string;
  source: SkillSource;
  enabled: boolean;
  /** Set when frontmatter validation failed; skill is listed but unusable. */
  error?: string;
}
