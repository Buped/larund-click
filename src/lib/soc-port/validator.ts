import type { SocPortOperation } from './types';

type SocPortOperationName = SocPortOperation['operation'];

export function cleanSocJson(text: string): string {
  let value = text.trim();
  if (value.startsWith('```json')) value = value.slice(7).trim();
  else if (value.startsWith('```')) value = value.slice(3).trim();
  if (value.endsWith('```')) value = value.slice(0, -3).trim();
  const start = value.indexOf('[');
  const end = value.lastIndexOf(']');
  if (start >= 0 && end > start) return value.slice(start, end + 1);
  return value;
}

export function parseSocOperations(raw: string): SocPortOperation[] {
  const parsed = JSON.parse(cleanSocJson(raw));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('soc_output_must_be_non_empty_json_array');
  return parsed.map(validateOperation);
}

function validateOperation(value: unknown): SocPortOperation {
  if (!value || typeof value !== 'object') throw new Error('soc_operation_must_be_object');
  const raw = value as Record<string, unknown>;
  const thought = String(raw.thought ?? '').trim();
  const operation = String(raw.operation ?? '').trim() as SocPortOperationName;
  if (!thought) throw new Error('soc_operation_missing_thought');
  if (!['click', 'write', 'press', 'done'].includes(operation)) throw new Error(`soc_operation_not_allowed:${operation}`);

  if (operation === 'click') {
    if (typeof raw.text === 'string' && raw.text.trim()) return { thought, operation, text: raw.text.trim() };
    if (typeof raw.label === 'string' && /^~\d+$/.test(raw.label.trim())) return { thought, operation, label: raw.label.trim() };
    const x = raw.x as string | number;
    const y = raw.y as string | number;
    assertPercent(x);
    assertPercent(y);
    return { thought, operation, x, y };
  }
  if (operation === 'write') {
    if (typeof raw.content !== 'string') throw new Error('soc_write_content_invalid');
    return { thought, operation, content: raw.content };
  }
  if (operation === 'press') {
    if (!Array.isArray(raw.keys) || raw.keys.some((key) => typeof key !== 'string' || !key.trim())) {
      throw new Error('soc_press_keys_invalid');
    }
    return { thought, operation, keys: raw.keys.map((key) => String(key).trim()) };
  }
  const summary = String(raw.summary ?? '').trim();
  if (!summary) throw new Error('soc_done_summary_empty');
  return { thought, operation, summary };
}

export function parsePercent(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`soc_percent_out_of_range:${value}`);
  }
  return parsed;
}

function assertPercent(value: string | number): void {
  parsePercent(value);
}
