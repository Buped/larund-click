import { recordBackend, type RecordRow } from '../coworker/persistence';
import type { RecentAction } from '../agent-state/types';
import type { OutputRef } from '../tasks/types';
import type { ToolRisk } from '../control-system/types';
import { createBuilderSkill, listBuilderSkills, updateBuilderSkill } from './builder/store';
import type { SkillBuilderKind, SkillBuilderSkill, SkillLearningMetadata, SkillTarget } from './builder/types';

const LEARNING_EVENTS = 'skill_learning_events';
const USAGE_EVENTS = 'skill_usage_events';
const LOW_RISK = new Set<ToolRisk>(['read_only', 'external_read', 'local_write']);
const CONTROL = new Set(['task.complete', 'ask_user', 'approval.request', 'skill.run']);
const READBACK = /read|list|tree|exists|get_state|assert|metadata|to_json|verify|extract/i;

export interface SkillLearningEvent {
  id: string;
  userId: string;
  workspaceId: string;
  taskRunId: string;
  title: string;
  prompt: string;
  toolSequence: string[];
  activeSkillIds: string[];
  readBackEvidenceCount: number;
  outputRefs: OutputRef[];
  kind: SkillBuilderKind;
  target?: SkillTarget;
  riskLevel: ToolRisk;
  explicitLearning: boolean;
  promotedSkillId?: string;
  createdAt: string;
}

export interface SkillUsageEvent {
  id: string;
  userId: string;
  workspaceId: string;
  taskRunId?: string;
  skillId: string;
  skillName: string;
  success: boolean;
  createdAt: string;
}

export interface LearnFromCompletedTaskInput {
  userId: string;
  workspaceId?: string;
  taskRunId?: string;
  title: string;
  prompt: string;
  activeSkillIds?: string[];
  recentActions: RecentAction[];
  outputRefs?: OutputRef[];
  autoLearnLowRisk?: boolean;
}

export interface LearnFromCompletedTaskResult {
  event?: SkillLearningEvent;
  promotedSkill?: SkillBuilderSkill;
}

export async function listLearningEvents(filter: { userId: string; workspaceId?: string }): Promise<SkillLearningEvent[]> {
  const rows = await recordBackend().all(LEARNING_EVENTS);
  return rows
    .map((row) => row as unknown as SkillLearningEvent)
    .filter((event) => event.userId === filter.userId)
    .filter((event) => !filter.workspaceId || event.workspaceId === filter.workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function recordSkillUsage(input: {
  userId: string;
  workspaceId?: string;
  taskRunId?: string;
  skillId: string;
  skillName: string;
  success: boolean;
}): Promise<void> {
  if (!input.workspaceId) return;
  const now = new Date().toISOString();
  const event: SkillUsageEvent = {
    id: `skill-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    taskRunId: input.taskRunId,
    skillId: input.skillId,
    skillName: input.skillName,
    success: input.success,
    createdAt: now,
  };
  await recordBackend().put(USAGE_EVENTS, event as unknown as RecordRow);

  const custom = await listBuilderSkills({ userId: input.userId, workspaceId: input.workspaceId, includeSuggested: true });
  const existing = custom.find((skill) => skill.id === input.skillId || skill.name === input.skillName || input.skillId.endsWith(`:${skill.name}`));
  if (!existing) return;
  const learning = bumpLearning(existing.learning, input.taskRunId, input.success, now);
  await updateBuilderSkill(existing.id, { learning });
}

export async function learnFromCompletedTask(input: LearnFromCompletedTaskInput): Promise<LearnFromCompletedTaskResult> {
  if (!input.workspaceId || !input.taskRunId) return {};

  const active = (input.activeSkillIds ?? []).filter((id) => !id.endsWith(':task-verification') && !id.includes('task-verification'));
  for (const skillId of active) {
    await recordSkillUsage({
      userId: input.userId,
      workspaceId: input.workspaceId,
      taskRunId: input.taskRunId,
      skillId,
      skillName: skillId.split(':').pop() ?? skillId,
      success: true,
    });
  }
  const customActive = active.filter((id) => !id.startsWith('bundled:'));
  if (customActive.length) return {};

  const toolSequence = compact(input.recentActions.filter((action) => action.success && !CONTROL.has(action.action)).map((action) => action.action));
  if (!toolSequence.length) return {};

  const now = new Date().toISOString();
  const target = inferTarget(input.prompt, input.recentActions);
  const event: SkillLearningEvent = {
    id: `skill-learn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    taskRunId: input.taskRunId,
    title: input.title,
    prompt: input.prompt,
    toolSequence,
    activeSkillIds: input.activeSkillIds ?? [],
    readBackEvidenceCount: input.recentActions.filter((action) => action.success && READBACK.test(action.action)).length,
    outputRefs: input.outputRefs ?? [],
    kind: target ? 'app_profile' : 'workflow',
    target,
    riskLevel: inferRisk(toolSequence),
    explicitLearning: isExplicitLearning(input.prompt),
    createdAt: now,
  };
  await recordBackend().put(LEARNING_EVENTS, event as unknown as RecordRow);

  const promoted = await maybePromote(input.userId, input.workspaceId, event, input.autoLearnLowRisk ?? true);
  if (promoted) {
    event.promotedSkillId = promoted.id;
    await recordBackend().put(LEARNING_EVENTS, event as unknown as RecordRow);
  }
  return { event, promotedSkill: promoted };
}

async function maybePromote(userId: string, workspaceId: string, event: SkillLearningEvent, autoLearnLowRisk: boolean): Promise<SkillBuilderSkill | undefined> {
  const events = await listLearningEvents({ userId, workspaceId });
  const cluster = events.filter((other) => similar(event, other) >= 0.45);
  const shouldPromote = event.explicitLearning || cluster.length >= 2;
  if (!shouldPromote) return undefined;

  const lowRisk = LOW_RISK.has(event.riskLevel);
  const autoEnabled = lowRisk && autoLearnLowRisk;
  const source = autoEnabled ? 'workspace' : 'suggested';
  const enabled = autoEnabled;
  const now = new Date().toISOString();
  const existing = await findMatchingSkill(userId, workspaceId, event);
  const learning = mergeLearning(existing?.learning, cluster.map((item) => item.taskRunId), autoEnabled, cluster.length / Math.max(2, cluster.length), now);
  if (existing) {
    return (await updateBuilderSkill(existing.id, {
      learning,
      enabled: existing.enabled || enabled,
      source: existing.source === 'suggested' && enabled ? 'workspace' : existing.source,
    })) ?? undefined;
  }

  return createBuilderSkill({
    userId,
    workspaceId,
    name: uniqueName(event),
    description: event.kind === 'app_profile'
      ? `Learned app/site profile from verified task: ${event.title}`
      : `Learned workflow from verified task: ${event.title}`,
    source,
    kind: event.kind,
    target: event.target,
    triggerPhrases: triggerPhrases(event),
    categories: event.kind === 'app_profile' ? ['app-profile', 'browser'] : ['learned', 'workflow'],
    whenToUse: event.kind === 'app_profile'
      ? [`Use for tasks on ${event.target?.domain ?? event.target?.appName ?? 'this app/site'}.`]
      : [`Use when the user asks for a workflow like: ${clip(event.title, 80)}.`],
    whenNotToUse: ['Do not use if the target app, domain, or requested output differs from the learned task.'],
    allowedTools: event.toolSequence,
    riskLevel: event.riskLevel,
    steps: event.toolSequence.slice(0, 8).map((tool, index) => ({
      id: `learned-step-${index}`,
      title: `Use ${tool}`,
      instruction: `Apply ${tool} as in the verified source task, then continue only if the read-back matches the expected state.`,
      preferredTools: [tool],
      required: true,
    })),
    verificationChecklist: [
      { id: 'learned-v1', title: 'Result was read back on the target surface', description: 'Use the matching read-back/assertion tool after the final write.', kind: 'read_back', required: true },
    ],
    fallbackStrategy: 'If the target surface differs or verification fails, stop and ask the user before improvising.',
    examplePrompts: [event.prompt],
    enabled,
    learning,
  });
}

async function findMatchingSkill(userId: string, workspaceId: string, event: SkillLearningEvent): Promise<SkillBuilderSkill | undefined> {
  const skills = await listBuilderSkills({ userId, workspaceId, includeSuggested: true });
  return skills.find((skill) => {
    if ((skill.kind ?? 'workflow') !== event.kind) return false;
    if (event.target?.domain && skill.target?.domain === event.target.domain) return true;
    const hay = `${skill.name} ${skill.description} ${skill.triggerPhrases.join(' ')}`;
    return similarText(hay, `${event.title} ${event.prompt}`) >= 0.5;
  });
}

function inferRisk(tools: string[]): ToolRisk {
  if (tools.some((tool) => /delete|kill/.test(tool))) return 'destructive';
  if (tools.some((tool) => /login|credential/.test(tool))) return 'credential_access';
  if (tools.some((tool) => /email\.compose/.test(tool))) return 'external_send';
  if (tools.some((tool) => /^connection\.|browser\.(type|click|paste|upload|shortcut|key)/.test(tool))) return 'external_write';
  if (tools.some((tool) => /cli\.run|process\.|code\./.test(tool))) return 'process_exec';
  if (tools.some((tool) => /write|mkdir|move|copy|append|export|download|format|chart|table/.test(tool))) return 'local_write';
  if (tools.some((tool) => /^browser\.|^web\.|^connection\./.test(tool))) return 'external_read';
  return 'read_only';
}

function inferTarget(prompt: string, recent: RecentAction[]): SkillTarget | undefined {
  const text = `${prompt}\n${recent.map((action) => `${action.argsSummary ?? ''} ${action.output ?? ''}`).join('\n')}`;
  const url = text.match(/https?:\/\/[^\s"')]+/)?.[0];
  const domain = url ? safeDomain(url) : text.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i)?.[0]?.toLowerCase();
  const usesBrowser = recent.some((action) => action.action.startsWith('browser.'));
  if (!usesBrowser && !domain) return undefined;
  return {
    domain,
    appName: domain ? undefined : prompt.match(/\b(Chrome|Gmail|Notion|GitHub|HubSpot|WordPress)\b/i)?.[0],
    urlPatterns: domain ? [`*://${domain}/*`] : [],
  };
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function isExplicitLearning(prompt: string): boolean {
  const plain = normalize(prompt);
  return /(tanuld meg|legkozelebb|mindig igy|jegyezd meg|remember this|next time|always do it this way)/i.test(plain);
}

function bumpLearning(existing: SkillLearningMetadata | undefined, taskRunId: string | undefined, success: boolean, now: string): SkillLearningMetadata {
  return {
    originTaskRunIds: [...new Set([...(existing?.originTaskRunIds ?? []), ...(taskRunId ? [taskRunId] : [])])],
    autoLearned: existing?.autoLearned ?? false,
    confidence: existing?.confidence ?? 0,
    promotedAt: existing?.promotedAt,
    lastUsedAt: now,
    usageCount: (existing?.usageCount ?? 0) + 1,
    successCount: (existing?.successCount ?? 0) + (success ? 1 : 0),
    failureCount: (existing?.failureCount ?? 0) + (success ? 0 : 1),
  };
}

function mergeLearning(existing: SkillLearningMetadata | undefined, taskRunIds: string[], autoLearned: boolean, confidence: number, now: string): SkillLearningMetadata {
  return {
    originTaskRunIds: [...new Set([...(existing?.originTaskRunIds ?? []), ...taskRunIds])],
    autoLearned,
    confidence: Math.max(existing?.confidence ?? 0, confidence),
    promotedAt: existing?.promotedAt ?? now,
    lastUsedAt: existing?.lastUsedAt,
    usageCount: existing?.usageCount ?? 0,
    successCount: existing?.successCount ?? 0,
    failureCount: existing?.failureCount ?? 0,
  };
}

function similar(a: SkillLearningEvent, b: SkillLearningEvent): number {
  if (a.kind !== b.kind) return 0;
  if (a.target?.domain && b.target?.domain && a.target.domain === b.target.domain) return 0.8;
  return similarText(`${a.title} ${a.prompt}`, `${b.title} ${b.prompt}`);
}

function similarText(a: string, b: string): number {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let inter = 0;
  for (const token of aa) if (bb.has(token)) inter++;
  return inter / (aa.size + bb.size - inter);
}

function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(/[^a-z0-9]+/i).filter((word) => word.length >= 4));
}

function triggerPhrases(event: SkillLearningEvent): string[] {
  const base = [...tokens(`${event.title} ${event.prompt}`)].slice(0, 6);
  if (event.target?.domain) base.unshift(event.target.domain);
  return [...new Set(base)];
}

function uniqueName(event: SkillLearningEvent): string {
  const prefix = event.kind === 'app_profile' ? 'App Profile' : 'Learned';
  const target = event.target?.domain ?? clip(event.title, 42);
  return `${prefix}: ${target}`;
}

function compact(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) if (out[out.length - 1] !== item) out.push(item);
  return [...new Set(out)];
}

function clip(value: string, max: number): string {
  const oneLine = value.trim().replace(/\s+/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max - 3)}...` : oneLine;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
