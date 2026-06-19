// Semantic chat titles. The sidebar used to show a truncated first message
// ("Van kettő számla a @S…"). Instead we ask a cheap model call to name the
// conversation in 3-7 words, in the conversation's own language. Runs async
// after the first exchange; never blocks the chat; never overwrites a title the
// user renamed by hand (the caller enforces the lock).

import { callOpenRouterJson } from '../openrouter';

const TITLE_SYSTEM = `You name a chat conversation for a sidebar.
Rules:
- 3 to 7 words, Title Case, no trailing period.
- Summarize the TOPIC or TASK, not the literal first words.
- Use the SAME language as the conversation (Hungarian in → Hungarian title).
- Do not include @mentions, file paths, or quotes unless truly central.
Respond with ONLY minified JSON: {"title":"..."}.`;

const MAX_TITLE_LEN = 60;

/** Normalize a raw model/title string into a clean sidebar title. */
export function sanitizeTitle(raw: string, fallback: string): string {
  let t = (raw ?? '').trim();
  // Tolerate the model wrapping it in quotes or returning a bare word.
  t = t.replace(/^["'`]+|["'`]+$/g, '').trim();
  t = t.replace(/[.\s]+$/g, '').trim();
  t = t.replace(/\s+/g, ' ');
  if (!t) return clipFallback(fallback);
  if (t.length > MAX_TITLE_LEN) t = `${t.slice(0, MAX_TITLE_LEN).trim()}…`;
  return t;
}

function clipFallback(fallback: string): string {
  const f = (fallback ?? '').trim().replace(/\s+/g, ' ') || 'New chat';
  return f.length > MAX_TITLE_LEN ? `${f.slice(0, MAX_TITLE_LEN).trim()}…` : f;
}

export interface TitleExchange {
  userText: string;
  assistantText: string;
}

/**
 * Generate a semantic title from the first exchange. Always resolves to a usable
 * string — on any error it falls back to a trimmed first user message so the
 * sidebar never shows raw JSON or an empty title.
 */
export async function generateChatTitle(
  exchange: TitleExchange,
  modelId: string,
  userId: string,
): Promise<string> {
  const fallback = exchange.userText;
  try {
    const convo = [
      `User: ${clip(exchange.userText, 600)}`,
      exchange.assistantText ? `Assistant: ${clip(exchange.assistantText, 600)}` : '',
    ].filter(Boolean).join('\n');

    const { content } = await callOpenRouterJson(
      [
        { role: 'system', content: TITLE_SYSTEM },
        { role: 'user', content: convo },
      ],
      modelId,
      userId,
      true,
    );
    const parsed = extractJson(content);
    const title = typeof parsed.title === 'string' ? parsed.title : '';
    return sanitizeTitle(title, fallback);
  } catch {
    return sanitizeTitle('', fallback);
  }
}

function clip(s: string, n: number): string {
  const t = (s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return { title: raw };
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return {};
  }
}
