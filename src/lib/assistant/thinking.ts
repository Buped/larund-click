export interface VisibleThinking {
  content: string;
}

export interface ParsedLarundEnvelope {
  thinking?: VisibleThinking;
  answer: string;
  hasEnvelope: boolean;
}

const THINKING_OPEN = '<larund_visible_thinking>';
const THINKING_CLOSE = '</larund_visible_thinking>';
const ANSWER_OPEN = '<larund_answer>';
const ANSWER_CLOSE = '</larund_answer>';
const VISUALIZATION_BLOCK_RE = /```visualization[^\n]*\n[\s\S]*?```/gi;

function between(value: string, open: string, close: string): { content: string; closed: boolean } | null {
  const start = value.indexOf(open);
  if (start < 0) return null;
  const contentStart = start + open.length;
  const end = value.indexOf(close, contentStart);
  if (end < 0) return { content: value.slice(contentStart), closed: false };
  return { content: value.slice(contentStart, end), closed: true };
}

function after(value: string, open: string): string | null {
  const start = value.indexOf(open);
  if (start < 0) return null;
  return value.slice(start + open.length);
}

export function parseLarundEnvelope(raw: string): ParsedLarundEnvelope {
  const thinkingBlock = between(raw, THINKING_OPEN, THINKING_CLOSE);
  const answerBlock = between(raw, ANSWER_OPEN, ANSWER_CLOSE);
  const hasEnvelope = Boolean(thinkingBlock || answerBlock || raw.includes(THINKING_OPEN) || raw.includes(ANSWER_OPEN));

  if (!hasEnvelope) {
    return { answer: raw, hasEnvelope: false };
  }

  const moved = moveVisualizationBlocksToAnswer(thinkingBlock?.content ?? '', answerBlock?.content ?? '');
  const thinkingContent = thinkingBlock ? moved.thinking : '';
  const thinking = thinkingContent.trim()
    ? { content: thinkingContent.trim() }
    : undefined;

  if (answerBlock) {
    return {
      thinking,
      answer: moved.answer.trimStart(),
      hasEnvelope: true,
    };
  }

  const answerTail = after(raw, ANSWER_OPEN);
  if (answerTail != null) {
    const tailMoved = moveVisualizationBlocksToAnswer(thinkingBlock?.content ?? '', answerTail);
    return {
      thinking: tailMoved.thinking.trim() ? { content: tailMoved.thinking.trim() } : undefined,
      answer: tailMoved.answer.trimStart(),
      hasEnvelope: true,
    };
  }

  if (thinkingBlock && !thinkingBlock.closed) {
    return { thinking, answer: moved.answer.trimStart(), hasEnvelope: true };
  }

  const fallbackStart = thinkingBlock
    ? raw.indexOf(THINKING_CLOSE) + THINKING_CLOSE.length
    : 0;
  const fallbackMoved = moveVisualizationBlocksToAnswer(thinkingBlock?.content ?? '', raw.slice(Math.max(0, fallbackStart)));
  return {
    thinking: fallbackMoved.thinking.trim() ? { content: fallbackMoved.thinking.trim() } : undefined,
    answer: fallbackMoved.answer.trimStart(),
    hasEnvelope: true,
  };
}

export function moveVisualizationBlocksToAnswer(thinkingRaw: string, answerRaw: string): { thinking: string; answer: string } {
  const moved: string[] = [];
  const thinking = thinkingRaw.replace(VISUALIZATION_BLOCK_RE, (block) => {
    moved.push(block.trim());
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  if (moved.length === 0) return { thinking: thinkingRaw, answer: answerRaw };
  const answer = [answerRaw.trimEnd(), ...moved].filter((part) => part.trim()).join('\n\n');
  return { thinking, answer };
}

export function serializeThinking(thinking?: VisibleThinking | null): string | null {
  if (!thinking?.content.trim()) return null;
  return JSON.stringify({ content: thinking.content.trim() });
}

export function parseThinking(raw?: string | null): VisibleThinking | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<VisibleThinking>;
    if (typeof parsed.content !== 'string' || !parsed.content.trim()) return undefined;
    return { content: parsed.content.trim() };
  } catch {
    return undefined;
  }
}
