// Memory suggestion pipeline (Phase 2). After a completed task, analyze the task
// run + evidence timeline and produce conservative memory *suggestions* (status
// 'suggested'), never silent active memories. The user reviews them in the queue.
//
// This is deterministic and pure: it takes plain data (no store access) so it is
// fully unit-testable. `generateSuggestions` returns CreateMemoryInput drafts;
// the caller persists them via `suggestMemory`.

import type { CreateMemoryInput, MemoryType } from './types';
import { extractMemoryCandidates } from './extractor';

export interface TaskSummaryForMemory {
  taskRunId: string;
  userId: string;
  workspaceId?: string;
  title: string;
  originalPrompt: string;
  summary?: string;
  status: string;
  /** The user's correction message(s) during the run, if any. */
  corrections?: string[];
  /** The most recent free-text user message in the run. */
  userText?: string;
}

export interface EvidenceForMemory {
  id: string;
  kind: string;
  title: string;
  content: string;
  tool?: string;
  success?: boolean;
}

export interface MemorySuggestionDraft extends CreateMemoryInput {
  /** Why this was suggested — shown in the review UI. */
  rationale: string;
}

const MAX_SUGGESTIONS = 5;

/**
 * Produce memory suggestions from a finished task. Conservative by design:
 * - corrections during the run → high-priority correction memory
 * - explicit user preference language → preference memory
 * - a verified outcome → evidence memory (workspace scope)
 * - a repeated structured tool sequence → procedural memory
 */
export function generateSuggestions(
  task: TaskSummaryForMemory,
  evidence: EvidenceForMemory[],
): MemorySuggestionDraft[] {
  const out: MemorySuggestionDraft[] = [];
  const verified = evidence.some((e) => e.kind === 'verification' && e.success === true);

  // 1. Corrections → high-priority correction memory.
  for (const correction of task.corrections ?? []) {
    if (!correction.trim()) continue;
    out.push({
      userId: task.userId,
      workspaceId: task.workspaceId,
      type: 'correction',
      title: `Correction: ${clip(correction, 60)}`,
      content: correctionLesson(correction, task),
      tags: keywords(`${correction} ${task.title}`),
      source: 'correction',
      confidence: 0.8,
      scope: task.workspaceId ? 'workspace' : 'global',
      writePolicy: 'suggest_then_confirm',
      sourceTaskRunId: task.taskRunId,
      rationale: 'You corrected the agent during this task; remember the lesson.',
    });
  }

  // 2/3. Preference / procedural from the user's own words.
  if (task.userText) {
    for (const c of extractMemoryCandidates({ userId: task.userId, userText: task.userText, summary: task.summary })) {
      if (c.type === 'preference' || c.type === 'procedural') {
        out.push(toDraft(task, c.type, c.title, c.content, c.tags, c.confidence, c.rationale));
      }
    }
  }

  // 3b. Procedural memory from a repeated structured tool sequence.
  const toolSeq = evidence.filter((e) => e.kind === 'tool_call' && e.tool).map((e) => e.tool!) as string[];
  if (toolSeq.length >= 3 && hasRepeatedPattern(toolSeq)) {
    out.push(
      toDraft(
        task,
        'procedural',
        `Procedure: ${clip(task.title, 50)}`,
        `For "${task.title}" tasks, a working sequence was: ${compactSeq(toolSeq).join(' → ')}. Reuse it and verify before completing.`,
        keywords(task.title),
        0.5,
        'This task repeated a structured tool sequence worth reusing.',
      ),
    );
  }

  // 4. Project memory — only when the prompt clearly states product/project direction.
  if (/\b(product direction|our product|we are building|the goal of|project is to)\b/i.test(task.originalPrompt)) {
    out.push(
      toDraft(
        task,
        'project',
        `Project note: ${clip(task.title, 50)}`,
        clip(task.originalPrompt, 240),
        keywords(task.originalPrompt),
        0.5,
        'The task stated project/product direction worth keeping.',
      ),
    );
  }

  // 5. Evidence memory — only for verified outcomes with a concrete artifact.
  if (verified && task.summary) {
    const artifact = evidence.find((e) => (e.kind === 'file_output' || e.kind === 'connection_output') && e.success);
    out.push({
      userId: task.userId,
      workspaceId: task.workspaceId,
      type: 'evidence',
      title: `Verified: ${clip(task.title, 55)}`,
      content: artifact ? `${task.summary}\nArtifact: ${clip(artifact.content, 120)}` : task.summary,
      tags: keywords(task.title),
      source: 'task',
      confidence: 0.6,
      scope: task.workspaceId ? 'workspace' : 'global',
      writePolicy: 'suggest_then_confirm',
      sourceTaskRunId: task.taskRunId,
      sourceEvidenceId: artifact?.id,
      rationale: 'A verified outcome — useful as a factual record.',
    });
  }

  return dedupeByTitle(out).slice(0, MAX_SUGGESTIONS);
}

function toDraft(
  task: TaskSummaryForMemory,
  type: MemoryType,
  title: string,
  content: string,
  tags: string[],
  confidence: number,
  rationale: string,
): MemorySuggestionDraft {
  return {
    userId: task.userId,
    workspaceId: task.workspaceId,
    type,
    title,
    content,
    tags,
    source: 'task',
    confidence,
    scope: task.workspaceId ? 'workspace' : 'global',
    writePolicy: 'suggest_then_confirm',
    sourceTaskRunId: task.taskRunId,
    rationale,
  };
}

function correctionLesson(correction: string, task: TaskSummaryForMemory): string {
  return `When working on "${task.title}"-style tasks: ${correction.trim()} — avoid repeating the mistake and verify the real target.`;
}

function hasRepeatedPattern(seq: string[]): boolean {
  const counts = new Map<string, number>();
  for (const t of seq) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 2);
}

function compactSeq(seq: string[]): string[] {
  const out: string[] = [];
  for (const t of seq) if (out[out.length - 1] !== t) out.push(t);
  return out.slice(0, 8);
}

function dedupeByTitle(drafts: MemorySuggestionDraft[]): MemorySuggestionDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const key = d.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function keywords(text: string): string[] {
  const stop = new Set(['always', 'please', 'from', 'that', 'this', 'with', 'your', 'task', 'tasks', 'mindig']);
  return [
    ...new Set(
      text.toLowerCase().split(/[^a-z0-9áéíóöőúüű]+/i).filter((w) => w.length >= 4 && !stop.has(w)),
    ),
  ].slice(0, 5);
}
