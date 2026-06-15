import type { ControlToolResult } from '../control-system/types';
import type { Skill } from './types';
import type { SkillRunner } from '../tools/types';
import { BUNDLED_SKILL_FILES } from './bundled';
import { loadSkillFromMarkdown, mergeSkills, scoreSkill } from './loader';
import { toRichManifest, type RichSkillManifest } from './manifest';
import { listBuilderSkills } from './builder/store';
import { compileToSkill } from './builder/compiler';

/** Build the active skill set (currently the validated bundled skills). */
export function loadAllSkills(): Skill[] {
  const bundled = BUNDLED_SKILL_FILES.map((f) => loadSkillFromMarkdown(f, 'bundled'));
  return mergeSkills(bundled).filter((s) => s.enabled);
}

/**
 * Build the active skill set INCLUDING enabled user/workspace builder skills,
 * compiled to runtime skills. Workspace skills override bundled ones with the
 * same name (mergeSkills precedence: bundled < user < workspace).
 */
export async function loadAllSkillsAsync(userId?: string, workspaceId?: string): Promise<Skill[]> {
  const bundled = BUNDLED_SKILL_FILES.map((f) => loadSkillFromMarkdown(f, 'bundled'));
  let custom: Skill[] = [];
  if (userId) {
    try {
      const builder = await listBuilderSkills({ userId, workspaceId });
      custom = builder
        .filter((s) => s.enabled && s.source !== 'suggested')
        .map(compileToSkill)
        .filter((s) => s.enabled);
    } catch {
      custom = [];
    }
  }
  return mergeSkills(bundled, custom).filter((s) => s.enabled);
}

/** Rich, product-grade manifests for every loaded skill. */
export function listRichSkillManifests(): RichSkillManifest[] {
  return loadAllSkills().map(toRichManifest);
}

/** Rich manifests including enabled custom user/workspace skills. */
export async function listRichSkillManifestsAsync(userId?: string, workspaceId?: string): Promise<RichSkillManifest[]> {
  return (await loadAllSkillsAsync(userId, workspaceId)).map(toRichManifest);
}

export function listSkillMetadata(): Array<Pick<Skill['manifest'], 'name' | 'description'> & { source: string; enabled: boolean }> {
  return loadAllSkills().map((s) => ({ name: s.manifest.name, description: s.manifest.description, source: s.source, enabled: s.enabled }));
}

export function findRelevantSkill(task: string): Skill | undefined {
  const ranked = loadAllSkills().map((s) => ({ s, score: scoreSkill(s, task) })).filter((x) => x.score > 0);
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.s;
}

/**
 * SkillRunner MVP: "running" a skill loads its instructions and allowed-tools
 * into the conversation so the model follows the workflow. Returns the body as
 * the action output; the loop feeds it back to the model.
 */
export function createSkillRunner(scope?: { userId?: string; workspaceId?: string }): SkillRunner {
  return {
    async run(name: string): Promise<ControlToolResult> {
      // Resolve fresh each run so newly-installed custom skills are picked up and
      // workspace-enabled builder skills are included.
      const skills = scope?.userId
        ? await loadAllSkillsAsync(scope.userId, scope.workspaceId)
        : loadAllSkills();
      const byName = new Map(skills.map((s) => [s.manifest.name, s]));
      const skill = byName.get(name);
      if (!skill) return { success: false, output: '', error: `unknown_skill:${name}` };
      return {
        success: true,
        output: `Skill "${skill.manifest.name}" loaded. Allowed tools: ${skill.manifest.allowed_tools.join(', ')}.\nRequires connections: ${skill.manifest.requires_connections.join(', ') || 'none'}.\n\n${skill.body}`,
        details: { skill: skill.manifest.name, allowed_tools: skill.manifest.allowed_tools, requires_connections: skill.manifest.requires_connections },
      };
    },
  };
}
