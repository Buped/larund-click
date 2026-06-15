// Skill suggestion from repeated tasks (Phase 2). When a similar task pattern
// appears 2+ times in the same workspace, propose a skill the user can edit and
// install. Pure: takes task summaries (title/prompt/tool sequence) and returns
// CreateSkillBuilderInput drafts. The caller persists them as source:'suggested'.

import type { CreateSkillBuilderInput, SkillStep } from './types';

export interface TaskPatternInput {
  taskRunId: string;
  workspaceId?: string;
  userId: string;
  title: string;
  prompt: string;
  /** Ordered tool names used in the run (from evidence tool_call entries). */
  tools: string[];
  /** True if the run completed with a passing verification. */
  verified?: boolean;
}

const MIN_OCCURRENCES = 2;

function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9áéíóöőúüű]+/i).filter((w) => w.length >= 4),
  );
}
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Cluster similar tasks within a workspace and emit a suggested skill per cluster
 * of size >= MIN_OCCURRENCES. Steps/tools/verification are inferred from the
 * shared tool sequence.
 */
export function suggestSkillsFromTasks(tasks: TaskPatternInput[], threshold = 0.45): CreateSkillBuilderInput[] {
  const clusters: TaskPatternInput[][] = [];
  const used = new Set<string>();

  for (let i = 0; i < tasks.length; i++) {
    if (used.has(tasks[i].taskRunId)) continue;
    const cluster = [tasks[i]];
    const aTok = tokens(`${tasks[i].title} ${tasks[i].prompt}`);
    for (let j = i + 1; j < tasks.length; j++) {
      if (used.has(tasks[j].taskRunId)) continue;
      if ((tasks[i].workspaceId ?? null) !== (tasks[j].workspaceId ?? null)) continue;
      if (similarity(aTok, tokens(`${tasks[j].title} ${tasks[j].prompt}`)) >= threshold) {
        cluster.push(tasks[j]);
        used.add(tasks[j].taskRunId);
      }
    }
    if (cluster.length >= MIN_OCCURRENCES) {
      used.add(tasks[i].taskRunId);
      clusters.push(cluster);
    }
  }

  return clusters.map((cluster) => clusterToDraft(cluster));
}

function clusterToDraft(cluster: TaskPatternInput[]): CreateSkillBuilderInput {
  const first = cluster[0];
  const commonTools = intersectTools(cluster.map((t) => t.tools));
  const allTools = [...new Set(cluster.flatMap((t) => t.tools))];
  const steps: SkillStep[] = compactSequence(commonTools.length ? commonTools : allTools)
    .slice(0, 6)
    .map((tool, i) => ({
      id: `step-${i}`,
      title: `Use ${tool}`,
      instruction: `Apply ${tool} as in previous similar tasks.`,
      preferredTools: [tool],
      required: true,
    }));

  return {
    userId: first.userId,
    workspaceId: first.workspaceId,
    name: `Auto: ${clip(first.title, 40)}`,
    description: `Suggested from ${cluster.length} similar tasks in this workspace. Review and edit before installing.`,
    source: 'suggested',
    triggerPhrases: [...new Set(cluster.flatMap((t) => keywords(t.title)))].slice(0, 6),
    categories: ['general'],
    allowedTools: allTools,
    riskLevel: inferRisk(allTools),
    steps,
    fallbackStrategy: 'If blocked, ask_user for a manual step or an alternative; never use a mouse.',
    examplePrompts: cluster.map((t) => clip(t.prompt, 80)).slice(0, 3),
    enabled: false,
  };
}

function intersectTools(seqs: string[][]): string[] {
  if (!seqs.length) return [];
  return seqs.reduce((acc, seq) => acc.filter((t) => seq.includes(t)), [...new Set(seqs[0])]);
}
function compactSequence(seq: string[]): string[] {
  const out: string[] = [];
  for (const t of seq) if (out[out.length - 1] !== t) out.push(t);
  return out;
}
function inferRisk(tools: string[]): CreateSkillBuilderInput['riskLevel'] {
  if (tools.some((t) => /delete|kill/.test(t))) return 'destructive';
  if (tools.some((t) => /^connection\.|browser\.(type|click|paste|upload)/.test(t))) return 'external_write';
  if (tools.some((t) => /write|mkdir|move|copy|append|export/.test(t))) return 'local_write';
  if (tools.some((t) => /cli\.run|process\./.test(t))) return 'process_exec';
  return 'read_only';
}
function keywords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9áéíóöőúüű]+/i).filter((w) => w.length >= 4))].slice(0, 4);
}
function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
