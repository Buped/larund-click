// Chat bridge — makes an automation run write the SAME user-facing narrative a
// chat run produces, into a linked chat session. An automation run is "a
// scheduled/triggered chat": trigger → agent loop → messages/evidence/artifacts
// → linked chat. This module is the single writer of those chat messages so we
// never duplicate the chat message store (see src/lib/database.ts).

import {
  addMessage,
  createSession,
  getSessionById,
  touchSession,
  updateMessage,
} from '../database';
import { updateAutomationRun, updateAutomation } from './store';
import {
  dedupeArtifacts,
  manifestToChatArtifact,
  parseArtifactManifest,
  type ChatArtifactAttachment,
} from '../artifacts/ui';
import type { AgentStep } from '../control-system/loop';
import type { Automation, AutomationRun } from './types';

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Best-effort: chat DB may not be initialised in some contexts (tests/headless). */
async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.warn('[automation chat-bridge] skipped:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Best-effort that reports success/failure rather than a value — for void DB
 * writes (createSession/addMessage) where `undefined` is the success result and
 * can't be used as a failure sentinel.
 */
async function tryOk(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    console.warn('[automation chat-bridge] skipped:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Effective chat mode with backfill for pre-existing automations that never had
 * the field (§17): a record with a linked session was implicitly attached, one
 * without defaults to a dedicated chat. We never write this back during a read —
 * persistence happens only on user save or first run.
 */
export function effectiveChatMode(automation: Pick<Automation, 'chatMode' | 'linkedChatSessionId'>): NonNullable<Automation['chatMode']> {
  if (automation.chatMode) return automation.chatMode;
  return automation.linkedChatSessionId ? 'append_to_existing' : 'create_new';
}

async function sessionExists(sessionId: string): Promise<boolean> {
  const row = await safe(() => getSessionById(sessionId));
  return Boolean(row);
}

/** Title of a linked chat (for cards/wizard), or null if it was deleted. */
export async function getLinkedChatTitle(sessionId: string): Promise<string | null> {
  const row = await safe(() => getSessionById(sessionId));
  return row && typeof row.title === 'string' ? row.title : null;
}

/**
 * Creates a dedicated chat session for an automation. Project-scoped so it shows
 * in the sidebar alongside the user's other chats. Reuses the existing session
 * table — no new chat data model.
 */
export async function createAutomationLinkedChat(args: {
  automationName?: string;
  projectId?: string | null;
}): Promise<{ sessionId: string; title: string } | null> {
  const title = (args.automationName?.trim() || 'Automation: Untitled').slice(0, 80);
  const sessionId = genId('auto-chat');
  const ok = await tryOk(() => createSession(sessionId, title, args.projectId ?? null));
  if (!ok) return null;
  return { sessionId, title };
}

/**
 * Returns the chat session this automation writes into. Precise per-mode rules:
 * - `none` → null (never writes/creates chat);
 * - `append_to_existing` → the linked session if it still exists, else null +
 *   warning (we never silently create a new chat the user didn't choose);
 * - `create_new` → reuse the linked session if it still exists, otherwise create
 *   a fresh dedicated chat and persist its id back onto the automation so we make
 *   at most one per automation.
 */
export async function ensureAutomationChatSession(automation: Automation): Promise<string | null> {
  const mode = effectiveChatMode(automation);
  if (mode === 'none') return null;

  if (mode === 'append_to_existing') {
    if (!automation.linkedChatSessionId) return null;
    if (await sessionExists(automation.linkedChatSessionId)) return automation.linkedChatSessionId;
    console.warn(`[automations] linked chat ${automation.linkedChatSessionId} no longer exists; not auto-creating for append_to_existing.`);
    return null;
  }

  // create_new
  if (automation.linkedChatSessionId && (await sessionExists(automation.linkedChatSessionId))) {
    return automation.linkedChatSessionId;
  }
  const created = await createAutomationLinkedChat({
    automationName: automation.name,
    projectId: automation.workspaceId ?? null,
  });
  if (!created) return null;
  // Persist back so future runs reuse the same dedicated chat (no-op if the
  // automation isn't saved yet — the createAutomation path sets it locally).
  await safe(() => updateAutomation(automation.id, { linkedChatSessionId: created.sessionId }));
  return created.sessionId;
}

function triggerSummaryLines(automation: Automation, triggerPayload: Record<string, unknown>): string {
  const lines: string[] = [`**Automation started: ${automation.name}**`];
  const reason = typeof triggerPayload.reason === 'string' ? triggerPayload.reason : undefined;
  const kind = typeof triggerPayload.kind === 'string' ? triggerPayload.kind : automation.trigger.kind;
  if (triggerPayload.fileName) lines.push(`Trigger: new file detected — ${String(triggerPayload.fileName)}`);
  else if (reason === 'manual_run') lines.push('Trigger: run now (manual)');
  else if (reason === 'test_run') lines.push('Trigger: test run');
  else if (kind === 'schedule') lines.push('Trigger: scheduled run');
  else lines.push(`Trigger: ${String(kind)}`);
  if (triggerPayload.filePath) lines.push(`File: ${String(triggerPayload.filePath)}`);
  if (triggerPayload.folderPath || triggerPayload.watchedPath) {
    lines.push(`Folder: ${String(triggerPayload.folderPath ?? triggerPayload.watchedPath)}`);
  }
  if (triggerPayload.pattern) lines.push(`Pattern: ${String(triggerPayload.pattern)}`);
  return lines.join('\n');
}

/**
 * Writes the "automation started" trigger message and creates the single live
 * agent message the run narrates into. Persists `chatSessionId`/`chatMessageId`
 * onto the run so later append calls can resolve the same message.
 */
export async function appendAutomationRunStartedMessage(args: {
  automation: Automation;
  run: AutomationRun;
  triggerPayload: Record<string, unknown>;
}): Promise<{ sessionId: string; messageId: string } | null> {
  if (effectiveChatMode(args.automation) === 'none') return null;
  const sessionId = args.run.chatSessionId ?? (await ensureAutomationChatSession(args.automation));
  if (!sessionId) return null;

  const triggerMsgId = genId('msg');
  await safe(() => addMessage(triggerMsgId, sessionId, 'user', triggerSummaryLines(args.automation, args.triggerPayload), {
    message_type: 'automation_trigger',
  }));

  const messageId = genId('msg');
  const created = await tryOk(() => addMessage(messageId, sessionId, 'assistant', '', {
    message_type: 'agent',
    agent_status: 'planning',
    agent_steps_json: '[]',
    agent_ask_question: null,
    artifacts_json: '[]',
  }));
  if (!created) return null;

  await updateAutomationRun(args.run.id, { chatSessionId: sessionId, chatMessageId: messageId });
  return { sessionId, messageId };
}

function artifactsFromSteps(steps: AgentStep[]): ChatArtifactAttachment[] {
  const found: ChatArtifactAttachment[] = [];
  for (const step of steps) {
    if (step.type === 'tool_result' && step.tool?.startsWith('artifact.render_') && step.output) {
      const manifest = parseArtifactManifest(step.output);
      if (manifest) found.push(manifestToChatArtifact(manifest));
    }
  }
  return dedupeArtifacts(found);
}

/**
 * Syncs the live agent message with the latest accumulated steps + status. Call
 * this on each `onStep`; it mirrors chat.tsx's streaming agent message exactly.
 */
export async function appendAutomationAgentStepMessage(args: {
  sessionId: string;
  messageId?: string;
  steps: AgentStep[];
  status?: 'planning' | 'running' | 'waiting_user' | 'waiting_approval';
}): Promise<void> {
  if (!args.messageId) return;
  const artifacts = artifactsFromSteps(args.steps);
  await safe(() => updateMessage(args.messageId!, {
    message_type: 'agent',
    agent_status: args.status ?? 'running',
    agent_steps_json: JSON.stringify(args.steps),
    ...(artifacts.length ? { artifacts_json: JSON.stringify(artifacts) } : {}),
  }));
  await safe(() => touchSession(args.sessionId));
}

/** Surfaces an ask_user question on the live message so the user can answer in chat. */
export async function appendAutomationAskUserMessage(args: {
  sessionId: string;
  messageId?: string;
  question: string;
  steps: AgentStep[];
}): Promise<void> {
  if (!args.messageId) return;
  await safe(() => updateMessage(args.messageId!, {
    message_type: 'agent',
    agent_status: 'waiting_user',
    agent_ask_question: args.question,
    agent_steps_json: JSON.stringify(args.steps),
  }));
  await safe(() => touchSession(args.sessionId));
}

/** Surfaces an approval request on the live message as an answerable block. */
export async function appendAutomationApprovalMessage(args: {
  sessionId: string;
  messageId?: string;
  approval: { action: string; risk: string; reason: string; argsSummary: string };
  steps: AgentStep[];
}): Promise<void> {
  if (!args.messageId) return;
  const question = `Approval needed — ${args.approval.action} (${args.approval.risk}). ${args.approval.reason}${args.approval.argsSummary ? `\n${args.approval.argsSummary}` : ''}`;
  await safe(() => updateMessage(args.messageId!, {
    message_type: 'agent',
    agent_status: 'waiting_user',
    agent_ask_question: question,
    agent_steps_json: JSON.stringify(args.steps),
  }));
  await safe(() => touchSession(args.sessionId));
}

/** Finalises the live message with the run summary + any generated artifacts. */
export async function appendAutomationCompletedMessage(args: {
  sessionId: string;
  messageId?: string;
  summary: string;
  steps: AgentStep[];
  artifacts?: ChatArtifactAttachment[];
}): Promise<void> {
  if (!args.messageId) return;
  const artifacts = args.artifacts ?? artifactsFromSteps(args.steps);
  await safe(() => updateMessage(args.messageId!, {
    content: args.summary,
    message_type: 'agent',
    agent_status: 'complete',
    agent_ask_question: null,
    agent_steps_json: JSON.stringify(args.steps),
    artifacts_json: JSON.stringify(artifacts),
  }));
  await safe(() => touchSession(args.sessionId));
}

/** Finalises the live message in a failed state. */
export async function appendAutomationFailedMessage(args: {
  sessionId: string;
  messageId?: string;
  error: string;
  steps: AgentStep[];
}): Promise<void> {
  if (!args.messageId) return;
  await safe(() => updateMessage(args.messageId!, {
    content: `Automation failed: ${args.error}`,
    message_type: 'agent',
    agent_status: 'error',
    agent_ask_question: null,
    agent_steps_json: JSON.stringify(args.steps),
  }));
  await safe(() => touchSession(args.sessionId));
}
