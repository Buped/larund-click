import { loadAllSkills } from '../runner';
import { listBuilderSkills, updateBuilderSkill, deleteBuilderSkill, createBuilderSkill, setBuilderSkillEnabled } from '../builder/store';
import type { CreateSkillBuilderInput, SkillBuilderPatch, SkillBuilderSkill } from '../builder/types';
import { builderSkillToPackage, skillToPackage } from './adapter';
import type { SkillPackage } from './types';
import { syncApprovedSharedSkills } from '../shared-store';

export async function listSkillPackages(args: {
  userId: string;
  workspaceId?: string;
  includeSuggested?: boolean;
}): Promise<SkillPackage[]> {
  const builtIn = loadAllSkills().map(skillToPackage);
  const custom = await listBuilderSkills({
    userId: args.userId,
    workspaceId: args.workspaceId,
    includeSuggested: args.includeSuggested,
  }).catch(() => []);
  const shared = await syncApprovedSharedSkills({ userId: args.userId, workspaceId: args.workspaceId }).catch(() => []);
  return dedupeByName([
    ...custom.map(builderSkillToPackage),
    ...shared.map((record) => builderSkillToPackage(record.manifestJson)),
    ...builtIn,
  ]);
}

export async function getSkillPackage(id: string, args: { userId: string; workspaceId?: string }): Promise<SkillPackage | null> {
  const all = await listSkillPackages({ ...args, includeSuggested: true });
  return all.find((s) => s.id === id || s.name === id || s.id.endsWith(`:${id}`)) ?? null;
}

export async function createSkillPackage(input: CreateSkillBuilderInput): Promise<SkillPackage> {
  return builderSkillToPackage(await createBuilderSkill(input));
}

export async function updateSkillPackage(id: string, patch: SkillBuilderPatch): Promise<SkillPackage | null> {
  const updated = await updateBuilderSkill(id, patch);
  return updated ? builderSkillToPackage(updated) : null;
}

export async function deleteSkillPackage(id: string): Promise<void> {
  await deleteBuilderSkill(id);
}

export async function setSkillPackageEnabled(skill: SkillPackage, enabled: boolean, args: { userId: string; workspaceId?: string }): Promise<SkillPackage | null> {
  if (skill.source === 'built_in') {
    const shadow: SkillBuilderSkill = {
      id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: args.userId,
      workspaceId: args.workspaceId,
      name: skill.name,
      version: skill.version,
      description: skill.description,
      source: args.workspaceId ? 'workspace' : 'user',
      kind: skill.kind ?? 'workflow',
      target: skill.target,
      learning: skill.learning,
      instructionBody: skill.instructionBody,
      triggerPhrases: skill.triggerPhrases,
      categories: skill.categories,
      whenToUse: skill.whenToUse,
      whenNotToUse: skill.whenNotToUse,
      requiredConnections: skill.requiredConnections,
      requiredMcpServers: skill.requiredMcpServers,
      allowedTools: skill.allowedTools,
      riskLevel: skill.riskLevel,
      inputSchema: undefined,
      outputSchema: undefined,
      steps: skill.steps.map((s) => ({ id: s.id, title: s.title, instruction: s.instruction, preferredTools: s.preferredTools, required: s.required })),
      verificationChecklist: skill.verificationChecklist.map((v) => ({
        id: v.id,
        title: v.title,
        description: v.description ?? v.title,
        kind: v.kind === 'contains_text' ? 'assert_text' : v.kind === 'connection_read_back' ? 'connection_read' : v.kind === 'file_read_back' || v.kind === 'doc_read_back' || v.kind === 'sheet_values_match' ? 'read_back' : v.kind,
        required: v.required,
        config: v.config,
      })),
      fallbackStrategy: 'If blocked, ask the user or pick a structured fallback; never use mouse/cursor/pixel automation.',
      examplePrompts: skill.examples.map((e) => e.userPrompt),
      exampleRuns: skill.examples.map((e) => e.expectedBehavior),
      enabled,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return builderSkillToPackage(await createBuilderSkill(shadow));
  }
  const updated = await setBuilderSkillEnabled(skill.id, enabled);
  return updated ? builderSkillToPackage(updated) : null;
}

function dedupeByName(skills: SkillPackage[]): SkillPackage[] {
  const seen = new Set<string>();
  const out: SkillPackage[] = [];
  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}
