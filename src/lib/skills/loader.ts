import { parseSkillFile } from './frontmatter';
import type { Skill, SkillSource } from './types';

/** Parse one SKILL.md string into a Skill (with validation error if invalid). */
export function loadSkillFromMarkdown(text: string, source: SkillSource): Skill {
  const parsed = parseSkillFile(text);
  if (!parsed.manifest) {
    return {
      manifest: { name: 'invalid', description: '', allowed_tools: [], requires_connections: [], risk: 'read_only' },
      body: parsed.body,
      source,
      enabled: false,
      error: parsed.error,
    };
  }
  return { manifest: parsed.manifest, body: parsed.body, source, enabled: parsed.manifest.status !== 'disabled' && parsed.manifest.status !== 'blocked' };
}

/**
 * Merge skills by name with precedence: workspace > project > user > bundled.
 * Later (higher-precedence) entries override earlier ones with the same name.
 */
export function mergeSkills(...layers: Skill[][]): Skill[] {
  const byName = new Map<string, Skill>();
  // Process in precedence order so the last write wins.
  const order: SkillSource[] = ['bundled', 'user', 'project', 'workspace'];
  const sorted = layers.flat().sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
  for (const skill of sorted) byName.set(skill.manifest.name, skill);
  return [...byName.values()];
}

/** Score a skill's relevance to a task by trigger/description/name keyword overlap. */
export function scoreSkill(skill: Skill, task: string): number {
  const hay = `${skill.manifest.trigger ?? ''} ${skill.manifest.description} ${skill.manifest.name}`.toLowerCase();
  const words = task.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  let score = 0;
  for (const w of new Set(words)) if (hay.includes(w)) score += 1;
  return score;
}
