// Workspace-aware skill ranking + prompt rendering. Pure functions over rich
// manifests so they are unit-testable without loading the bundled markdown.

import type { RichSkillManifest } from './manifest';

export interface SkillRankingOptions {
  /** Skill ids enabled for the active workspace. Empty = use enabledByDefault. */
  enabledSkillIds?: string[];
  /** Connection ids currently configured/enabled, to down-rank unusable skills. */
  availableConnectionIds?: string[];
  /** Skill names a selected role prefers — boosted in ranking. */
  boostSkillNames?: string[];
  /** Categories a selected role prefers — boosted in ranking. */
  boostCategories?: string[];
  limit?: number;
}

export interface RankedSkill {
  manifest: RichSkillManifest;
  score: number;
  /** True when the skill needs a connection that is not available. */
  missingConnection: boolean;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9áéíóöőúüű]+/i).filter((w) => w.length >= 3);
}

/** Is this skill enabled in the given workspace context? */
export function isSkillEnabled(manifest: RichSkillManifest, opts: SkillRankingOptions): boolean {
  if (opts.enabledSkillIds && opts.enabledSkillIds.length) {
    return opts.enabledSkillIds.includes(manifest.id) || opts.enabledSkillIds.includes(manifest.name);
  }
  return manifest.enabledByDefault;
}

export function scoreSkillManifest(manifest: RichSkillManifest, task: string): number {
  const taskTokens = new Set(tokenize(task));
  if (taskTokens.size === 0) return 0;
  let score = 0;
  for (const t of manifest.trigger) if (taskTokens.has(t.toLowerCase())) score += 3;
  for (const t of tokenize(manifest.name)) if (taskTokens.has(t)) score += 2;
  for (const c of manifest.categories) if (taskTokens.has(c.toLowerCase())) score += 1;
  for (const t of tokenize(manifest.description)) if (taskTokens.has(t)) score += 0.5;
  return Math.round(score * 100) / 100;
}

/**
 * Rank workspace-enabled skills by task relevance. Skills requiring a missing
 * connection are kept but flagged + de-prioritized (they may still be the right
 * skill — the agent will hit a clear "missing auth" blocker rather than fail
 * silently).
 */
export function rankSkillsForTask(
  manifests: RichSkillManifest[],
  task: string,
  opts: SkillRankingOptions = {},
): RankedSkill[] {
  const available = new Set(opts.availableConnectionIds ?? []);
  const boostNames = new Set((opts.boostSkillNames ?? []).map((n) => n.toLowerCase()));
  const boostCats = new Set((opts.boostCategories ?? []).map((c) => c.toLowerCase()));
  const ranked = manifests
    .filter((m) => isSkillEnabled(m, opts))
    .map((manifest) => {
      const missingConnection =
        manifest.requiredConnections.length > 0 &&
        !manifest.requiredConnections.every((c) => available.has(c));
      let score = scoreSkillManifest(manifest, task);
      // Role bias: prefer the role's default skills / categories even on weak
      // lexical match, so the selected role visibly shapes which skills surface.
      if (boostNames.has(manifest.name.toLowerCase())) score += 2.5;
      if (manifest.categories.some((c) => boostCats.has(c.toLowerCase()))) score += 1;
      if (missingConnection) score *= 0.4;
      return { manifest, score, missingConnection };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return typeof opts.limit === 'number' ? ranked.slice(0, opts.limit) : ranked;
}

const MAX_PROMPT_SKILLS = 4;

/** Render a compact "Relevant skills" block for the system prompt. */
export function renderRelevantSkills(ranked: RankedSkill[]): string {
  const top = ranked.slice(0, MAX_PROMPT_SKILLS);
  if (!top.length) return '';
  const lines = top.map((r) => {
    const conn = r.manifest.requiredConnections.length
      ? ` (needs: ${r.manifest.requiredConnections.join(', ')}${r.missingConnection ? ' — NOT configured' : ''})`
      : '';
    return `- ${r.manifest.name}: ${r.manifest.description}${conn}`;
  });
  return `## Relevant skills\nRun the best-fit skill with skill.run before improvising.\n${lines.join('\n')}`;
}
