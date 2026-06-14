import type { SocOperation } from './types';
import { parsePercentCoordinate } from './coordinates';

const ALLOWED = new Set(['click', 'click_text', 'click_label', 'write', 'press', 'wait', 'ask_user', 'done']);

export function cleanJsonOutput(text: string): string {
  let value = text.trim();
  if (value.startsWith('```json')) value = value.slice(7).trim();
  else if (value.startsWith('```')) value = value.slice(3).trim();
  if (value.endsWith('```')) value = value.slice(0, -3).trim();
  const start = value.indexOf('[');
  const end = value.lastIndexOf(']');
  if (start >= 0 && end > start) value = value.slice(start, end + 1);
  return value;
}

export function validateSocOperations(raw: string | unknown): SocOperation[] {
  const parsed = typeof raw === 'string' ? JSON.parse(cleanJsonOutput(raw)) : raw;
  if (!Array.isArray(parsed)) throw new Error('soc_model_output_must_be_json_array');
  if (parsed.length === 0) throw new Error('soc_model_output_empty_array');
  return parsed.map(validateOne);
}

function validateOne(value: unknown): SocOperation {
  if (!value || typeof value !== 'object') throw new Error('soc_operation_must_be_object');
  const raw = value as Record<string, unknown>;
  const operation = String(raw.operation ?? '').trim();
  const thought = String(raw.thought ?? '').trim();
  if (!thought) throw new Error('soc_operation_missing_thought');
  if (!ALLOWED.has(operation)) throw new Error(`soc_operation_not_allowed:${operation}`);

  switch (operation) {
    case 'click':
      parsePercentCoordinate(raw.x as string | number);
      parsePercentCoordinate(raw.y as string | number);
      return { thought, operation, x: raw.x as string | number, y: raw.y as string | number };
    case 'click_text': {
      const text = String(raw.text ?? '').trim();
      if (!text) throw new Error('soc_click_text_empty');
      return { thought, operation, text };
    }
    case 'click_label': {
      const label = String(raw.label ?? '').trim();
      if (!/^~\d+$/.test(label)) throw new Error('soc_click_label_invalid');
      return { thought, operation, label };
    }
    case 'write':
      if (typeof raw.content !== 'string') throw new Error('soc_write_content_invalid');
      return { thought, operation, content: raw.content };
    case 'press':
      if (!Array.isArray(raw.keys) || raw.keys.some((k) => typeof k !== 'string' || !k.trim())) {
        throw new Error('soc_press_keys_invalid');
      }
      return { thought, operation, keys: raw.keys.map((k) => String(k).trim()) };
    case 'wait':
      return { thought, operation, ms: Number.isFinite(raw.ms) ? Number(raw.ms) : undefined };
    case 'ask_user': {
      const question = String(raw.question ?? '').trim();
      if (!question) throw new Error('soc_ask_user_question_empty');
      return { thought, operation, question };
    }
    case 'done': {
      const summary = String(raw.summary ?? '').trim();
      if (!summary) throw new Error('soc_done_summary_empty');
      return { thought, operation, summary };
    }
  }
  throw new Error('soc_operation_unreachable');
}
