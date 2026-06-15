import { createBuilderSkill, listBuilderSkills } from '../skills/builder/store';
import type { SkillBuilderSkill } from '../skills/builder/types';
import type { ToolRisk } from '../tools/types';
import type { SkillPackage, SkillPackageValidation } from './types';

const DANGEROUS: ToolRisk[] = ['external_send', 'destructive', 'credential_access', 'process_exec'];

export async function exportSkillPackage(args: {
  userId: string;
  workspaceId?: string;
  skillIds?: string[];
  name: string;
  description: string;
  publisher?: string;
}): Promise<SkillPackage> {
  const all = await listBuilderSkills({ userId: args.userId, workspaceId: args.workspaceId });
  const skills = args.skillIds?.length ? all.filter((s) => args.skillIds!.includes(s.id)) : all;
  const requestedPermissions = [...new Set(skills.map((s) => s.riskLevel))];
  const partial = {
    manifestVersion: '1.0',
    packageId: `pkg-${slug(args.name)}-${Date.now()}`,
    name: args.name,
    version: '1.0.0',
    publisher: args.publisher,
    description: args.description,
    skills,
    workflowTemplates: [],
    requiredConnections: [...new Set(skills.flatMap((s) => s.requiredConnections))],
    requiredMcpServers: [...new Set(skills.flatMap((s) => s.requiredMcpServers))],
    requestedPermissions,
  };
  return { ...partial, checksum: checksum(partial) };
}

export function validateSkillPackage(pkg: unknown): SkillPackageValidation {
  const errors: string[] = [];
  const p = pkg as Partial<SkillPackage>;
  if (!p || typeof p !== 'object') errors.push('package must be an object');
  if (p.manifestVersion !== '1.0') errors.push('unsupported manifestVersion');
  if (!p.packageId || !p.name || !p.version || !p.description) errors.push('missing required package metadata');
  if (!Array.isArray(p.skills)) errors.push('skills must be an array');
  if (!Array.isArray(p.requestedPermissions)) errors.push('requestedPermissions must be an array');
  const computed = checksum({ ...p, checksum: undefined, signature: undefined });
  if (p.checksum !== computed) errors.push('checksum mismatch');
  const dangerousPermissions = (p.requestedPermissions ?? []).filter((r): r is ToolRisk => DANGEROUS.includes(r as ToolRisk));
  return { ok: errors.length === 0, errors, dangerousPermissions, checksum: computed, signatureVerified: false };
}

export async function importSkillPackage(args: {
  userId: string;
  workspaceId?: string;
  pkg: SkillPackage;
}): Promise<SkillBuilderSkill[]> {
  const validation = validateSkillPackage(args.pkg);
  if (!validation.ok) throw new Error(`invalid_skill_package:${validation.errors.join(',')}`);
  const imported: SkillBuilderSkill[] = [];
  for (const skill of args.pkg.skills) {
    imported.push(await createBuilderSkill({
      userId: args.userId,
      workspaceId: args.workspaceId,
      name: skill.name,
      description: skill.description,
      source: 'imported',
      triggerPhrases: skill.triggerPhrases,
      categories: skill.categories,
      whenToUse: skill.whenToUse,
      whenNotToUse: skill.whenNotToUse,
      requiredConnections: skill.requiredConnections,
      requiredMcpServers: skill.requiredMcpServers,
      allowedTools: skill.allowedTools,
      riskLevel: skill.riskLevel,
      steps: skill.steps,
      verificationChecklist: skill.verificationChecklist,
      fallbackStrategy: skill.fallbackStrategy,
      examplePrompts: skill.examplePrompts,
      enabled: false,
    }));
  }
  return imported;
}

export function checksum(value: unknown): string {
  const text = stableStringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'package';
}
