import { callOpenRouterJson } from '../openrouter';
import { webSearch } from '../web-search/provider';
import type { WebSearchResultItem } from '../web-search/types';
import type { RecentAction } from '../agent-state/types';
import type { SkillBuilderSkill } from './builder/types';
import { dryRunSkill, type DryRunResult } from './builder/test-runner';
import type { SkillGapDecision } from './skill-gap';

const LEARNING_MODEL = 'google/gemini-3.1-flash-lite';

export interface SkillResearchSummary {
  targetLabel: string;
  query: string;
  sources: WebSearchResultItem[];
  appOrSiteKind: string;
  workflowSteps: string[];
  apiFirstRecommendation?: string;
  blockers: string[];
  needsLogin: boolean;
}

export interface SelfLearnedSkillDraft {
  skill: SkillBuilderSkill;
  dryRun: DryRunResult;
  warnings: string[];
}

function clean(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => clean(item, 300)).filter((item): item is string => Boolean(item)) : [];
}

function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function riskFromActions(actions: RecentAction[]): SkillBuilderSkill['riskLevel'] {
  const tools = actions.map((action) => action.action);
  if (tools.some((tool) => /delete|kill|remove/.test(tool))) return 'destructive';
  if (tools.some((tool) => /browser\.login|credential/.test(tool))) return 'credential_access';
  if (tools.some((tool) => /email\.compose/.test(tool))) return 'external_send';
  if (tools.some((tool) => /^connection\.|browser\.(type|click|paste|upload|key|shortcut)/.test(tool))) return 'external_write';
  if (tools.some((tool) => /cli\.run|process\.|code\./.test(tool))) return 'process_exec';
  if (tools.some((tool) => /write|mkdir|move|copy|append|download|upload|render|format|chart|table/.test(tool))) return 'local_write';
  if (tools.some((tool) => /^browser\.|^web\.|^connection\./.test(tool))) return 'external_read';
  return 'read_only';
}

export async function researchSkillGap(decision: SkillGapDecision, ctx: { userId: string; locale?: string; country?: string }): Promise<SkillResearchSummary> {
  const label = decision.target?.label ?? decision.task.slice(0, 80);
  const query = `${label} how to ${decision.task.slice(0, 120)} official docs API workflow`;
  const search = await webSearch({ query, maxResults: 5, depth: 'quick', locale: ctx.locale, country: ctx.country });
  const { content } = await callOpenRouterJson(
    [
      {
        role: 'system',
        content: [
          'Summarize research for a reusable Larund skill. Return ONLY minified JSON.',
          'Keys: appOrSiteKind, workflowSteps, apiFirstRecommendation, blockers, needsLogin.',
          'Use sources only as factual hints; do not copy source text. Prefer official API/docs when available.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: decision.task,
          target: decision.target,
          sources: search.results.map((item) => ({ title: item.title, url: item.url, snippet: item.snippet })),
        }),
      },
    ],
    LEARNING_MODEL,
    ctx.userId,
    true,
  );
  const parsed = extractJson(content);
  return {
    targetLabel: label,
    query,
    sources: search.results,
    appOrSiteKind: clean(parsed.appOrSiteKind, 180) ?? 'Unknown app/site',
    workflowSteps: list(parsed.workflowSteps),
    apiFirstRecommendation: clean(parsed.apiFirstRecommendation, 500),
    blockers: list(parsed.blockers),
    needsLogin: parsed.needsLogin === true,
  };
}

export async function synthesizeSelfLearnedSkill(args: {
  userId: string;
  workspaceId?: string;
  taskRunId?: string;
  task: string;
  evidence: RecentAction[];
  research: SkillResearchSummary;
}): Promise<SelfLearnedSkillDraft | null> {
  if (!args.workspaceId || !args.taskRunId) return null;
  if (!args.evidence.some((action) => action.success)) return null;
  const blockers = args.evidence.filter((action) => !action.success && /login|captcha|permission|blocked/i.test(`${action.error ?? ''} ${action.output ?? ''}`));
  if (blockers.length) return null;
  const successfulTools = [...new Set(args.evidence.filter((action) => action.success && !['task.complete', 'ask_user', 'approval.request', 'skill.run'].includes(action.action)).map((action) => action.action))];
  if (!successfulTools.length) return null;
  const { content } = await callOpenRouterJson(
    [
      {
        role: 'system',
        content: [
          'Create a conservative Larund SkillBuilderSkill draft from verified task evidence and research.',
          'Return ONLY minified JSON with keys: name, description, triggerPhrases, categories, whenToUse, whenNotToUse, steps, verificationChecklist, fallbackStrategy, examplePrompts.',
          'Do not include secrets, passwords, copied source text, or claims that bypass approval gates.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: args.task,
          research: args.research,
          allowedTools: successfulTools,
          evidence: args.evidence.slice(-25).map((action) => ({
            action: action.action,
            success: action.success,
            argsSummary: action.argsSummary,
            output: action.output?.slice(0, 500),
            error: action.error,
          })),
        }),
      },
    ],
    LEARNING_MODEL,
    args.userId,
    true,
  );
  const parsed = extractJson(content);
  const now = new Date().toISOString();
  const title = clean(parsed.name, 80) ?? `Learned: ${args.research.targetLabel}`;
  const skill: SkillBuilderSkill = {
    id: nowId('self-skill'),
    userId: args.userId,
    workspaceId: args.workspaceId,
    name: title,
    version: '1.0.0',
    description: clean(parsed.description, 300) ?? `Self-learned draft for ${args.research.targetLabel}.`,
    source: 'self_learned',
    status: 'pending_review',
    kind: args.research.targetLabel.includes('.') ? 'app_profile' : 'workflow',
    target: args.research.targetLabel.includes('.') ? { domain: args.research.targetLabel, urlPatterns: [`*://${args.research.targetLabel}/*`] } : { appName: args.research.targetLabel },
    learning: {
      originTaskRunIds: [args.taskRunId],
      autoLearned: true,
      confidence: 0.45,
      usageCount: 0,
      successCount: 1,
      failureCount: 0,
      lastUsedAt: now,
    },
    instructionBody: undefined,
    triggerPhrases: list(parsed.triggerPhrases).length ? list(parsed.triggerPhrases) : [args.research.targetLabel],
    categories: list(parsed.categories).length ? list(parsed.categories) : ['self-learned', 'workflow'],
    whenToUse: list(parsed.whenToUse).length ? list(parsed.whenToUse) : [`Use for tasks like: ${args.task.slice(0, 120)}`],
    whenNotToUse: list(parsed.whenNotToUse).length ? list(parsed.whenNotToUse) : ['Do not use if the app/site, account state, or requested workflow differs from the learned evidence.'],
    requiredConnections: [],
    requiredMcpServers: [],
    allowedTools: successfulTools,
    riskLevel: riskFromActions(args.evidence),
    steps: list(parsed.steps).map((step, index) => ({
      id: `step-${index + 1}`,
      title: step.slice(0, 80),
      instruction: step,
      preferredTools: successfulTools.slice(0, 3),
      required: true,
    })),
    verificationChecklist: list(parsed.verificationChecklist).map((item, index) => ({
      id: `v-${index + 1}`,
      title: item.slice(0, 140),
      description: item,
      kind: 'read_back',
      required: true,
    })),
    fallbackStrategy: clean(parsed.fallbackStrategy, 1000) ?? 'If the learned path fails, stop and ask_user before improvising; never bypass approval or manual blockers.',
    examplePrompts: list(parsed.examplePrompts).length ? list(parsed.examplePrompts) : [args.task],
    exampleRuns: [],
    enabled: false,
    createdAt: now,
    updatedAt: now,
    originTaskRunId: args.taskRunId,
  };
  if (!skill.steps.length) {
    skill.steps = successfulTools.slice(0, 8).map((tool, index) => ({
      id: `step-${index + 1}`,
      title: `Use ${tool}`,
      instruction: `Use ${tool} as proven in the source task, then verify before continuing.`,
      preferredTools: [tool],
      required: true,
    }));
  }
  if (!skill.verificationChecklist.length) {
    skill.verificationChecklist = [{ id: 'v-read-back', title: 'Result was read back', description: 'Read back the target state or output before completion.', kind: 'read_back', required: true }];
  }
  const dryRun = dryRunSkill(skill, { prompt: args.task });
  return { skill, dryRun, warnings: dryRun.warnings };
}
