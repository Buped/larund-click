// Intent router for Chat. Larund decides automatically whether a message is a
// conversational request (answer normally), an action request (run the no-mouse
// agent), or ambiguous (ask one clarifying question). This replaces the manual
// "Agent mode" toggle that used to be exposed in the UI.
//
// Strategy: a fast, deterministic heuristic handles the clear-cut majority of
// cases for free (no token cost, no latency). Only genuinely ambiguous messages
// fall through to a tiny LLM classification call.

import { callOpenRouterJson } from '../openrouter';

export type IntentMode = 'chat' | 'agent' | 'clarify';

export interface IntentClassification {
  mode: IntentMode;
  confidence: number;
  reason: string;
  requiredCapabilities: string[];
}

export interface IntentInput {
  text: string;
  /** True when the user attached files/folders. */
  hasReferences: boolean;
}

// Verbs that almost always mean "do something in the world" → agent.
const ACTION_VERBS = [
  'create', 'make', 'write a file', 'open ', 'update', 'upload', 'download', 'send',
  'email', 'schedule', 'connect ', 'connect to', 'organi', 'organise', 'organize', 'sort', 'clean',
  'rename', 'move', 'delete', 'export', 'import', 'fill out', 'fill in', 'submit',
  'post', 'publish', 'run ', 'execute', 'install', 'commit', 'push', 'deploy',
  'read this folder', 'read the folder', 'scan', 'spreadsheet', 'sheet',
  // Hungarian (the product is used in HU as well)
  'hozz létre', 'készíts', 'nyisd', 'nyiss', 'írd', 'írj egy fájl', 'töltsd',
  'küldd', 'küldj', 'ütemezz', 'rendszerezd', 'rendezd', 'olvasd vissza',
  'olvasd be', 'exportáld', 'mentsd', 'frissítsd', 'töröld', 'nevezd át',
];

// Openers that almost always mean "talk/think with me" → chat.
const CHAT_OPENERS = [
  'what do you think', 'what is', "what's", 'whats', 'explain', 'how does',
  'why ', 'who ', 'when ', 'where ', 'can you explain', 'tell me about',
  'difference between', 'should i', 'help me understand', 'summarize this',
  'summarise this', 'what are the pros', 'give me ideas', 'brainstorm',
  'mi a különbség', 'mi az', 'mit gondolsz', 'magyarázd', 'miért', 'hogyan működik',
  'sorolj fel', 'adj ötlet', 'mesélj',
];

// Words that, when paired with an action verb on attachments, imply real output.
const OUTPUT_HINTS = ['into a file', 'to a file', 'save as', 'save it', 'export', 'create a', 'spreadsheet', 'pdf', 'docx', 'fájlba', 'mentsd', 'exportáld'];

function includesAny(haystack: string, needles: string[]): string | null {
  for (const n of needles) if (haystack.includes(n)) return n;
  return null;
}

/**
 * Deterministic first pass. Returns a confident classification, or null when the
 * message is ambiguous enough to warrant the model.
 */
export function heuristicIntent(inputRaw: IntentInput): IntentClassification | null {
  const text = inputRaw.text.trim().toLowerCase();
  if (!text && inputRaw.hasReferences) {
    // Bare attachment with no instruction → ask what to do.
    return { mode: 'clarify', confidence: 0.6, reason: 'Attachment with no instruction.', requiredCapabilities: [] };
  }
  if (!text) return { mode: 'chat', confidence: 0.5, reason: 'Empty message.', requiredCapabilities: [] };

  const action = includesAny(text, ACTION_VERBS);
  const chatty = includesAny(text, CHAT_OPENERS);
  const explicitOutput = includesAny(text, OUTPUT_HINTS);
  const startsQuestion = text.startsWith('what') || text.startsWith('how') || text.startsWith('why') || text.startsWith('mi ') || text.startsWith('mi a') || text.startsWith('miért');

  // Attachment + analysis-only question → chat. Attachment + output/action → agent.
  if (inputRaw.hasReferences) {
    const wantsOutput = action || explicitOutput;
    if (wantsOutput) return { mode: 'agent', confidence: 0.85, reason: 'Action/output requested on attachment.', requiredCapabilities: capsFor(text) };
    if (chatty) return { mode: 'chat', confidence: 0.8, reason: 'Analysis-only question about attachment.', requiredCapabilities: [] };
  }

  // A conversational opener wins unless the user explicitly asked for output —
  // this keeps "what's the difference between connection and MCP?" in chat even
  // though it mentions tool-ish nouns.
  if (chatty && !explicitOutput && startsQuestion) {
    return { mode: 'chat', confidence: 0.85, reason: 'Conversational/explanatory request.', requiredCapabilities: [] };
  }

  // Clear action verb and not framed as a question → agent.
  if (action && !startsQuestion) {
    return { mode: 'agent', confidence: 0.82, reason: `Action verb: "${action.trim()}".`, requiredCapabilities: capsFor(text) };
  }

  // Conversational opener with no action verb → chat.
  if (chatty && !action) {
    return { mode: 'chat', confidence: 0.85, reason: 'Conversational/explanatory request.', requiredCapabilities: [] };
  }

  // Short questions ending in "?" with no action verb → chat.
  if (text.endsWith('?') && !action) {
    return { mode: 'chat', confidence: 0.7, reason: 'Question with no action.', requiredCapabilities: [] };
  }

  return null;
}

function capsFor(text: string): string[] {
  const caps: string[] = [];
  if (/file|fájl|folder|mappa|desktop|asztal/.test(text)) caps.push('files');
  if (/browser|web|website|oldal|url|http/.test(text)) caps.push('browser');
  if (/sheet|spreadsheet|excel|táblázat/.test(text)) caps.push('sheets');
  if (/email|gmail|mail|levél/.test(text)) caps.push('email');
  if (/calendar|naptár|event/.test(text)) caps.push('calendar');
  if (/schedule|recurring|ütemez|naponta|every day/.test(text)) caps.push('schedule');
  if (/command|cli|shell|terminal|parancs/.test(text)) caps.push('cli');
  return caps;
}

const SYSTEM = `You route a user's chat message for an AI coworker named Larund.
Classify into exactly one mode:
- "chat": questions, explanations, brainstorming, advice, copywriting with no file/system output requested.
- "agent": the user wants Larund to DO something — create/modify files, use the browser, update sheets/docs, send/email, schedule, call a connection, run commands, or any multi-step real-world task.
- "clarify": genuinely ambiguous; you cannot tell whether they want an answer or an action.
Respond with ONLY minified JSON: {"mode","confidence","reason","requiredCapabilities"}.
confidence is 0..1. requiredCapabilities is a short array like ["files","browser","sheets","email"].`;

/**
 * Classify a chat message. Uses the heuristic when confident; otherwise asks the
 * model. Always resolves — on any model error it falls back to a safe default
 * (chat) so the user is never blocked.
 */
export async function classifyIntent(input: IntentInput, modelId: string, userId: string): Promise<IntentClassification> {
  const fast = heuristicIntent(input);
  if (fast && fast.confidence >= 0.8) return fast;

  try {
    const { content } = await callOpenRouterJson(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${input.hasReferences ? '[user attached file(s)] ' : ''}${input.text}` },
      ],
      modelId,
      userId,
      true,
    );
    const json = extractJson(content);
    const mode: IntentMode = json.mode === 'agent' || json.mode === 'clarify' ? json.mode : 'chat';
    return {
      mode,
      confidence: typeof json.confidence === 'number' ? json.confidence : 0.6,
      reason: typeof json.reason === 'string' ? json.reason : 'Model classification.',
      requiredCapabilities: Array.isArray(json.requiredCapabilities) ? json.requiredCapabilities.map(String) : capsFor(input.text.toLowerCase()),
    };
  } catch {
    // Network/credit error: fall back to the heuristic, or chat.
    return fast ?? { mode: 'chat', confidence: 0.4, reason: 'Classifier unavailable; answering normally.', requiredCapabilities: [] };
  }
}

function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return {};
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return {}; }
}
