// Rich skill manifest layer (Phase 1). This is the product-grade view of a skill
// derived from the existing parsed `Skill`. It is purely additive: legacy bundled
// markdown skills (which only declare name/description/allowed_tools/…) get a
// stable id, a default version, derived categories and a verification checklist,
// so the rest of the platform can treat every skill uniformly.

import type { ToolRisk } from '../control-system/types';
import type { Skill, SkillSource } from './types';

export type SkillManifestSource = 'bundled' | 'workspace' | 'user' | 'marketplace' | 'imported';

export interface RichSkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  trigger: string[];
  categories: string[];
  allowedTools: string[];
  requiredConnections: string[];
  requiredMcpServers: string[];
  risk: ToolRisk;
  verificationChecklist: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  enabledByDefault: boolean;
  source: SkillManifestSource;
  status?: string;
  originRepo?: string;
  originPath?: string;
  tags: string[];
  supportsAutomation: boolean;
  supportsManualRun: boolean;
  kind: 'workflow' | 'app_profile';
  target?: Record<string, unknown>;
  learning?: Record<string, unknown>;
}

const DEFAULT_VERSION = '1.0.0';

function mapSource(source: SkillSource): SkillManifestSource {
  // Internal sources map onto the product-facing taxonomy. 'project' folds into
  // 'workspace' since both are workspace-scoped overrides.
  switch (source) {
    case 'project':
      return 'workspace';
    case 'workspace':
      return 'workspace';
    case 'user':
      return 'user';
    case 'bundled':
    default:
      return 'bundled';
  }
}

/** Best-effort category inference from a skill's name/trigger when none declared. */
function inferCategories(skill: Skill): string[] {
  const hay = `${skill.manifest.name} ${skill.manifest.trigger ?? ''} ${skill.manifest.description}`.toLowerCase();
  const cats = new Set<string>();
  if (/(git|github|code|vscode|test|build|repo|pull request)/.test(hay)) cats.add('development');
  if (/(market|campaign|analytics|report|content)/.test(hay)) cats.add('marketing');
  if (/(sheet|csv|excel|data|table|invoice|accounting)/.test(hay)) cats.add('data');
  if (/(doc|notion|drive|workspace|gmail|calendar|office)/.test(hay)) cats.add('productivity');
  if (/(browser|web|website|form)/.test(hay)) cats.add('browser');
  if (/(file|folder|organize)/.test(hay)) cats.add('files');
  if (cats.size === 0) cats.add('general');
  return [...cats];
}

/** Split a free-text trigger string into keyword triggers. */
function triggerList(trigger?: string): string[] {
  if (!trigger) return [];
  return trigger.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
}

/** A default verification checklist when a skill declares none. */
function defaultChecklist(risk: ToolRisk): string[] {
  const base = ['Confirm the exact target surface the user requested was changed.'];
  if (risk === 'read_only') return [...base, 'Confirm the read returned the expected content.'];
  return [
    ...base,
    'Read the result back with an appropriate tool before completing.',
    'If a login/manual blocker occurred, hand off to the user instead of claiming success.',
  ];
}

export function toRichManifest(skill: Skill): RichSkillManifest {
  const m = skill.manifest;
  const source = mapSource(skill.source);
  return {
    id: `${source}:${m.name}`,
    name: m.name,
    version: m.version ?? DEFAULT_VERSION,
    description: m.description,
    trigger: triggerList(m.trigger),
    categories: m.categories?.length ? m.categories : inferCategories(skill),
    allowedTools: m.allowed_tools,
    requiredConnections: m.requires_connections,
    requiredMcpServers: m.required_mcp_servers ?? [],
    risk: m.risk,
    verificationChecklist: m.verification_checklist?.length ? m.verification_checklist : defaultChecklist(m.risk),
    whenToUse: m.when_to_use ?? [],
    whenNotToUse: m.when_not_to_use ?? [],
    enabledByDefault: m.enabled_by_default ?? true,
    source,
    status: m.status,
    originRepo: m.origin_repo,
    originPath: m.origin_path,
    tags: m.tags ?? [],
    supportsAutomation: m.supports_automation ?? true,
    supportsManualRun: m.supports_manual_run ?? true,
    kind: m.metadata?.kind === 'app_profile' ? 'app_profile' : 'workflow',
    target: typeof m.metadata?.target === 'object' && m.metadata.target !== null ? m.metadata.target as Record<string, unknown> : undefined,
    learning: typeof m.metadata?.learning === 'object' && m.metadata.learning !== null ? m.metadata.learning as Record<string, unknown> : undefined,
  };
}
