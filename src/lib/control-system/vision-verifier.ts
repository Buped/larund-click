// Visual verifier — the vision counterpart of the (text/DOM-based) goal verifier.
//
// IMPORTANT: this is PERCEPTION ONLY, never control. It captures a screenshot of
// the current surface (browser/desktop/artifact) and asks a vision model whether
// the task's success criteria are visibly satisfied. It returns a structured
// verdict the loop and the completion guard consume. It NEVER emits coordinates,
// clicks, bounding boxes or any pixel-targeting output — the no-mouse contract in
// docs/NO_MOUSE_CORE.md applies to *control*, not to read-only verification.

import { callOpenRouterJson, type ChatMessage, type MessageContent } from '../openrouter';

/** The vision model that judges screenshots. Cheap, fast, multimodal. */
export const VISION_JUDGE_MODEL = 'google/gemini-3.1-flash-lite';

export interface VisualVerdict {
  /** True only when every required success criterion is visibly satisfied. */
  done: boolean;
  /** Coarse 0–100 progress estimate toward the goal. */
  progress: number;
  /** Criteria the screenshot visibly satisfies. */
  metCriteria: string[];
  /** Criteria not yet satisfied (or not visible). */
  unmetCriteria: string[];
  /** Visible manual blockers (login wall, captcha, permission, error dialog). */
  blockers: string[];
  /** One short, plain-language description of what is on screen. */
  observation: string;
  /** What to do next when not done (no pixel targeting — structured steps only). */
  nextStepHint: string;
  /** Judge confidence 0–1. */
  confidence: number;
}

export interface RunVisualVerificationArgs {
  /** One or more screenshot data URLs (data:image/jpeg;base64,…). */
  imageDataUrls: string[];
  /** The success criteria to check against the screenshot. */
  criteria: string[];
  /** The task goal, for context. */
  goal: string;
  userId: string;
  /** Optional focused question the agent wants the judge to answer. */
  question?: string;
  /** Cost sink so the agent loop batches deduction (mirrors makeSectionSummarizer). */
  addCost?: (usd: number) => void;
  /** Injectable transport for tests; defaults to callOpenRouterJson. */
  call?: typeof callOpenRouterJson;
}

const VISION_JUDGE_SYSTEM = `You are a strict VISUAL VERIFIER for an AI operator. You are shown a screenshot of
the operator's current screen (a browser page, a desktop app window, or a document
preview) plus the task goal and a list of success criteria.

Your ONLY job is to judge, from what is VISIBLE in the screenshot, whether each
success criterion is satisfied. You are a perception/verification component:
- NEVER output coordinates, pixel locations, bounding boxes, or click instructions.
- NEVER claim something is done if it is not clearly visible. When unsure, mark it unmet.
- Detect manual blockers that make the outcome impossible to confirm: login/sign-in
  walls, CAPTCHA / "I am not a robot", permission prompts, and error dialogs/toasts.

Reply with ONLY a JSON object, no prose, no markdown fences, in exactly this shape:
{
  "done": boolean,
  "progress": number,            // 0-100
  "metCriteria": string[],       // criteria visibly satisfied (copy their text)
  "unmetCriteria": string[],     // criteria not satisfied / not visible
  "blockers": string[],          // visible blockers, [] if none
  "observation": string,         // one short sentence of what is on screen
  "nextStepHint": string,        // what to do next if not done (structured, no pixels)
  "confidence": number           // 0-1
}
"done" is true ONLY when every listed criterion is in metCriteria and there are no blockers.`;

/** Extract the first JSON object from model text (mirrors parser.extractJson). */
function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** A safe, non-completing verdict used whenever the judge fails or returns garbage. */
export function inconclusiveVerdict(reason: string): VisualVerdict {
  return {
    done: false,
    progress: 0,
    metCriteria: [],
    unmetCriteria: [],
    blockers: [],
    observation: `Visual check inconclusive: ${reason}`,
    nextStepHint: 'Re-capture the screen and verify again, or fall back to a structured read-back.',
    confidence: 0,
  };
}

/** Parse a raw model response into a VisualVerdict, never throwing. */
export function parseVisualVerdict(raw: string): VisualVerdict {
  const json = extractJsonObject(raw);
  if (!json) return inconclusiveVerdict('no JSON in vision response');
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return inconclusiveVerdict('vision response was not valid JSON');
  }
  const metCriteria = toStringArray(obj.metCriteria);
  const unmetCriteria = toStringArray(obj.unmetCriteria);
  const blockers = toStringArray(obj.blockers);
  // "done" is only honoured when nothing is unmet and no blocker is visible.
  const done = obj.done === true && unmetCriteria.length === 0 && blockers.length === 0;
  return {
    done,
    progress: clampNumber(obj.progress, 0, 100, done ? 100 : 0),
    metCriteria,
    unmetCriteria,
    blockers,
    observation: typeof obj.observation === 'string' ? obj.observation : '',
    nextStepHint: typeof obj.nextStepHint === 'string' ? obj.nextStepHint : '',
    confidence: clampNumber(obj.confidence, 0, 1, 0.5),
  };
}

/**
 * Capture-free visual verification: given screenshots already captured by the
 * executor, ask the vision judge whether the criteria are visibly satisfied.
 */
export async function runVisualVerification(args: RunVisualVerificationArgs): Promise<VisualVerdict> {
  const { imageDataUrls, criteria, goal, userId, question, addCost } = args;
  if (!imageDataUrls.length) return inconclusiveVerdict('no screenshot was captured');

  const call = args.call ?? callOpenRouterJson;
  const criteriaBlock = criteria.length
    ? criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '(no explicit criteria — judge whether the goal is visibly accomplished)';
  const textIntro =
    `TASK GOAL:\n${goal}\n\nSUCCESS CRITERIA:\n${criteriaBlock}` +
    (question ? `\n\nFOCUS QUESTION: ${question}` : '') +
    `\n\nJudge ONLY from the attached screenshot(s). Reply with the JSON verdict.`;

  const userContent: MessageContent = [
    { type: 'text', text: textIntro },
    ...imageDataUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
  const messages: ChatMessage[] = [
    { role: 'system', content: VISION_JUDGE_SYSTEM },
    { role: 'user', content: userContent },
  ];

  try {
    // deductCredits:false — the agent loop batches the cost via addCost/finalDeduct.
    const { content, usage } = await call(messages, VISION_JUDGE_MODEL, userId, false);
    addCost?.(usage.costUsd);
    return parseVisualVerdict(content);
  } catch (err) {
    return inconclusiveVerdict(err instanceof Error ? err.message : String(err));
  }
}
