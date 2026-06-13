// Vision Mouse V2 — ActionPlan schema validation & normalization.
//
// The planner returns ONE JSON object. This validates it against the ActionPlan
// contract and normalizes loose-but-valid shapes (e.g. a bare {x,y} raw click,
// or keys given as "ctrl+shift+x"). Pure + unit-tested. The executor must reject
// anything this returns an error for, so a malformed plan never reaches input.

import type { ActionPlan, ActionType, VerificationSpec, VerificationType } from './types';

const ACTIONS: ActionType[] = [
  'cli_command', 'browser_open',
  'click_element', 'click_text', 'click_label', 'hotkey', 'type_text',
  'scroll', 'raw_click', 'wait', 'done', 'ask_user',
];

const VERIFY_TYPES: VerificationType[] = [
  'text_appears', 'text_disappears', 'window_changed', 'panel_opened',
  'url_changed', 'focus_changed', 'visual_change', 'llm_check', 'none',
];

export interface ValidationOk { ok: true; plan: ActionPlan; }
export interface ValidationErr { ok: false; error: string; }
export type ValidationResult = ValidationOk | ValidationErr;

function parseKeys(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) return raw.map(String).map((k) => k.trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split('+').map((k) => k.trim()).filter(Boolean);
  return undefined;
}

function normalizeVerification(raw: unknown): VerificationSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const type = VERIFY_TYPES.includes(r.type as VerificationType)
    ? (r.type as VerificationType)
    : 'none';
  return {
    type,
    value: typeof r.value === 'string' ? r.value : undefined,
    timeout_ms: typeof r.timeout_ms === 'number' ? r.timeout_ms : undefined,
    required: typeof r.required === 'boolean' ? r.required : undefined,
  };
}

export function validateActionPlan(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'plan is not an object' };
  }
  const r = raw as Record<string, unknown>;
  const action = r.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action as ActionType)) {
    return { ok: false, error: `unknown or missing action: ${String(action)}` };
  }
  const a = action as ActionType;

  const target = (r.target && typeof r.target === 'object')
    ? (r.target as Record<string, unknown>)
    : {};
  const plan: ActionPlan = {
    action: a,
    reason: typeof r.reason === 'string' ? r.reason : '',
    confidence: typeof r.confidence === 'number' ? r.confidence : 0,
    target: {
      element_id: typeof target.element_id === 'string' ? target.element_id : undefined,
      text: typeof target.text === 'string' ? target.text : undefined,
      x: typeof target.x === 'number' ? target.x : (typeof r.x === 'number' ? r.x : undefined),
      y: typeof target.y === 'number' ? target.y : (typeof r.y === 'number' ? r.y : undefined),
    },
    text: typeof r.text === 'string' ? r.text : undefined,
    command: typeof r.command === 'string' ? r.command : (typeof r.cmd === 'string' ? r.cmd : undefined),
    working_dir: typeof r.working_dir === 'string' ? r.working_dir : undefined,
    url: typeof r.url === 'string' ? r.url : undefined,
    clear_before_typing: typeof r.clear_before_typing === 'boolean' ? r.clear_before_typing : undefined,
    press_enter: typeof r.press_enter === 'boolean' ? r.press_enter : undefined,
    keys: parseKeys(r.keys),
    direction: ['up', 'down', 'left', 'right'].includes(r.direction as string)
      ? (r.direction as ActionPlan['direction']) : undefined,
    amount: typeof r.amount === 'number' ? r.amount : undefined,
    timeout_ms: typeof r.timeout_ms === 'number' ? r.timeout_ms : undefined,
    question: typeof r.question === 'string' ? r.question : undefined,
    summary: typeof r.summary === 'string' ? r.summary : undefined,
    expect: normalizeVerification(r.expect),
  };

  // Per-action required fields.
  switch (a) {
    case 'cli_command':
      if (!plan.command) return { ok: false, error: 'cli_command requires command' };
      break;
    case 'browser_open':
      if (!plan.url) return { ok: false, error: 'browser_open requires url' };
      break;
    case 'click_element':
      if (!plan.target?.element_id) return { ok: false, error: 'click_element requires target.element_id' };
      break;
    case 'click_text':
    case 'click_label': {
      const t = plan.target?.text ?? plan.text;
      if (!t) return { ok: false, error: `${a} requires target.text` };
      if (!plan.target) plan.target = {};
      plan.target.text = t;
      break;
    }
    case 'hotkey':
      if (!plan.keys || plan.keys.length === 0) return { ok: false, error: 'hotkey requires keys' };
      break;
    case 'type_text':
      if (typeof plan.text !== 'string') return { ok: false, error: 'type_text requires text' };
      break;
    case 'raw_click':
      if (typeof plan.target?.x !== 'number' || typeof plan.target?.y !== 'number') {
        return { ok: false, error: 'raw_click requires target.x and target.y' };
      }
      break;
    case 'ask_user':
      if (!plan.question) return { ok: false, error: 'ask_user requires question' };
      break;
    // scroll / wait / done have sensible defaults.
  }

  return { ok: true, plan };
}
