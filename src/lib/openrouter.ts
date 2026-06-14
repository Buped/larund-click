import { supabase, getUserCredits } from './supabase';
import { MODEL_PRICING, MARKUP } from '../constants/models';

const OPENROUTER_KEY = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;

// How often we re-check the user's real balance during streaming.
// This is a READ-ONLY check — no deductions happen mid-stream.
const BALANCE_CHECK_INTERVAL_MS = 5_000;

// Fallback token estimate when OpenRouter doesn't return usage data:
// ~4 characters per token is a conservative estimate for most languages.
const CHARS_PER_TOKEN = 4;

export type MessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: MessageContent;
}

export interface UsageResult {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

function estimateInputChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    return sum + m.content.reduce((s, c) => s + (c.type === 'text' ? c.text.length : 500), 0);
  }, 0);
}

export async function callOpenRouter(
  messages: ChatMessage[],
  openrouterId: string,
  userId: string,
  onChunk: (chunk: string) => void,
  onComplete: (usage: UsageResult) => void,
  onError: (error: string) => void,
  serviceTier?: string,
): Promise<void> {
  if (!OPENROUTER_KEY || OPENROUTER_KEY === 'your_openrouter_key_here') {
    onError('OpenRouter API key not configured');
    return;
  }

  // ── 1. Pre-flight: check real balance before starting ────────────────────
  //
  // We read the ACTUAL balance from Supabase — no guesswork.
  // If the user truly has no credits, we reject before even calling OpenRouter.
  const preCredits = await getUserCredits(userId);
  if (preCredits !== null && preCredits.uc_balance <= 0) {
    onError('Nincs elég kredit — tölts fel kreditet a folytatáshoz.');
    return;
  }

  // ── 2. Build request — no max_tokens cap ─────────────────────────────────
  //
  // stream_options.include_usage instructs OpenRouter to attach real token
  // counts to the final SSE chunk, which we use for the single accurate
  // deduction at the end.
  const body: Record<string, unknown> = {
    model: openrouterId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    // No max_tokens — the AI runs until it finishes or credits run out
  };
  if (serviceTier) body.service_tier = serviceTier;

  let res: Response;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://larund.io',
        'X-Title': 'Larund Click',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
    return;
  }

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    onError(`OpenRouter error ${res.status}: ${err}`);
    return;
  }

  const pricing = MODEL_PRICING[openrouterId] ?? { input: 0, output: 0 };

  // Kept for the fallback estimate in case OpenRouter doesn't send usage data
  const inputChars = messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    return sum + m.content.reduce((s, c) => s + (c.type === 'text' ? c.text.length : 500), 0);
  }, 0);
  let accumulatedOutputChars = 0;

  // Real token counts delivered by OpenRouter in the final SSE chunk
  let finalInputTokens  = 0;
  let finalOutputTokens = 0;

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastBalanceCheckAt = Date.now();

  // ── 3. Streaming loop ─────────────────────────────────────────────────────
  //
  // IMPORTANT: We NEVER deduct credits here. We only check the real balance
  // every 5 seconds. Estimation-based mid-stream deductions caused false
  // "no credits" errors because estimates always overshoot the real cost.
  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break outer;
        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            onChunk(chunk);
            accumulatedOutputChars += chunk.length;
          }
          // Capture real usage from the final content chunk
          if (parsed.usage) {
            finalInputTokens  = parsed.usage.prompt_tokens     ?? 0;
            finalOutputTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch { /* malformed SSE chunk — skip */ }
      }

      // ── Periodic balance check (read-only, no deduction) ─────────────
      const now = Date.now();
      if (now - lastBalanceCheckAt >= BALANCE_CHECK_INTERVAL_MS) {
        lastBalanceCheckAt = now;
        try {
          const currentCredits = await getUserCredits(userId);
          if (currentCredits !== null && currentCredits.uc_balance <= 0) {
            reader.cancel();
            onError('Nincs elég kredit — tölts fel kreditet a folytatáshoz.');
            return;
          }
        } catch {
          // Network hiccup during balance check — don't stop the stream,
          // just skip this check and try again next interval.
        }
      }
    }
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
    return;
  }

  // ── 4. Single final deduction — always based on real token counts ─────────
  //
  // OpenRouter provides exact token counts via stream_options.include_usage.
  // If for some reason they're missing (provider limitation), we fall back
  // to the character-based estimate.
  const usedInputTok  = finalInputTokens  > 0
    ? finalInputTokens
    : Math.ceil(inputChars / CHARS_PER_TOKEN);
  const usedOutputTok = finalOutputTokens > 0
    ? finalOutputTokens
    : Math.ceil(accumulatedOutputChars / CHARS_PER_TOKEN);

  const costUsd = ((usedInputTok * pricing.input + usedOutputTok * pricing.output) / 1_000_000) * MARKUP;

  if (costUsd > 0) {
    const { error } = await supabase.rpc('deduct_uc_credits', {
      p_user_id:  userId,
      p_cost_usd: costUsd,
    });
    if (error) {
      // Log but don't fail — the user already received the response.
      // Credit reconciliation can be handled separately if needed.
      console.warn('Credit deduction failed after stream:', error.message);
    }
  }

  onComplete({
    inputTokens: usedInputTok,
    outputTokens: usedOutputTok,
    costUsd,
    model: openrouterId,
  });
}

// Like callOpenRouter but skips the final credit deduction when deductCredits=false.
// Used by the agent loop so it can batch all per-step costs into one deduction
// at the end of the full session.
export async function callOpenRouterWithTools(
  messages: ChatMessage[],
  modelId: string,
  userId: string,
  onChunk: (chunk: string) => void,
  onComplete: (usage: UsageResult) => void,
  onError: (error: string) => void,
  deductCredits: boolean = true,
): Promise<void> {
  if (!OPENROUTER_KEY || OPENROUTER_KEY === 'your_openrouter_key_here') {
    onError('OpenRouter API key not configured');
    return;
  }

  const preCredits = await getUserCredits(userId);
  if (preCredits !== null && preCredits.uc_balance <= 0) {
    onError('Nincs elég kredit — tölts fel kreditet a folytatáshoz.');
    return;
  }

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    // Low temperature keeps the model on-format; agent tasks need precision, not creativity.
    temperature: 0,
  };

  let res: Response;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://larund.io',
        'X-Title': 'Larund Click',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
    return;
  }

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    onError(`OpenRouter error ${res.status}: ${err}`);
    return;
  }

  const pricing = MODEL_PRICING[modelId] ?? { input: 0, output: 0 };
  const inputChars = messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    return sum + m.content.reduce((s, c) => s + (c.type === 'text' ? c.text.length : 500), 0);
  }, 0);
  let accumulatedOutputChars = 0;
  let finalInputTokens = 0;
  let finalOutputTokens = 0;

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastBalanceCheckAt = Date.now();

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break outer;
        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            onChunk(chunk);
            accumulatedOutputChars += chunk.length;
          }
          if (parsed.usage) {
            finalInputTokens  = parsed.usage.prompt_tokens     ?? 0;
            finalOutputTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch { /* malformed SSE chunk — skip */ }
      }

      const now = Date.now();
      if (now - lastBalanceCheckAt >= BALANCE_CHECK_INTERVAL_MS) {
        lastBalanceCheckAt = now;
        try {
          const currentCredits = await getUserCredits(userId);
          if (currentCredits !== null && currentCredits.uc_balance <= 0) {
            reader.cancel();
            onError('Nincs elég kredit — tölts fel kreditet a folytatáshoz.');
            return;
          }
        } catch { /* skip on network hiccup */ }
      }
    }
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
    return;
  }

  const usedInputTok  = finalInputTokens  > 0 ? finalInputTokens  : Math.ceil(inputChars / CHARS_PER_TOKEN);
  const usedOutputTok = finalOutputTokens > 0 ? finalOutputTokens : Math.ceil(accumulatedOutputChars / CHARS_PER_TOKEN);
  const costUsd = ((usedInputTok * pricing.input + usedOutputTok * pricing.output) / 1_000_000) * MARKUP;

  if (deductCredits && costUsd > 0) {
    const { error } = await supabase.rpc('deduct_uc_credits', {
      p_user_id:  userId,
      p_cost_usd: costUsd,
    });
    if (error) {
      console.warn('Credit deduction failed after stream:', error.message);
    }
  }

  onComplete({
    inputTokens: usedInputTok,
    outputTokens: usedOutputTok,
    costUsd,
    model: modelId,
  });
}

export async function callOpenRouterJson(
  messages: ChatMessage[],
  modelId: string,
  userId: string,
  deductCredits: boolean = true,
): Promise<{ content: string; usage: UsageResult }> {
  if (!OPENROUTER_KEY || OPENROUTER_KEY === 'your_openrouter_key_here') {
    throw new Error('OpenRouter API key not configured');
  }

  const preCredits = await getUserCredits(userId);
  if (preCredits !== null && preCredits.uc_balance <= 0) {
    throw new Error('Nincs elég kredit - tölts fel kreditet a folytatáshoz.');
  }

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: false,
    temperature: 0,
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://larund.io',
      'X-Title': 'Larund Click',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const parsed = await res.json();
  const content = String(parsed.choices?.[0]?.message?.content ?? '');
  if (!content.trim()) throw new Error('OpenRouter returned empty content');

  const pricing = MODEL_PRICING[modelId] ?? { input: 0, output: 0 };
  const inputTokens = Number(parsed.usage?.prompt_tokens) || Math.ceil(estimateInputChars(messages) / CHARS_PER_TOKEN);
  const outputTokens = Number(parsed.usage?.completion_tokens) || Math.ceil(content.length / CHARS_PER_TOKEN);
  const costUsd = ((inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000) * MARKUP;

  if (deductCredits && costUsd > 0) {
    const { error } = await supabase.rpc('deduct_uc_credits', {
      p_user_id: userId,
      p_cost_usd: costUsd,
    });
    if (error) console.warn('Credit deduction failed after JSON call:', error.message);
  }

  return {
    content,
    usage: {
      inputTokens,
      outputTokens,
      costUsd,
      model: modelId,
    },
  };
}
