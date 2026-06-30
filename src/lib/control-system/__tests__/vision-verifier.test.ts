import { describe, expect, it, vi } from 'vitest';
import { parseVisualVerdict, runVisualVerification, inconclusiveVerdict } from '../vision-verifier';
import type { callOpenRouterJson } from '../../openrouter';

describe('parseVisualVerdict', () => {
  it('parses a well-formed verdict (with code fences)', () => {
    const raw = '```json\n{"done":true,"progress":100,"metCriteria":["row visible"],"unmetCriteria":[],"blockers":[],"observation":"grid shows the row","nextStepHint":"","confidence":0.9}\n```';
    const v = parseVisualVerdict(raw);
    expect(v.done).toBe(true);
    expect(v.progress).toBe(100);
    expect(v.metCriteria).toEqual(['row visible']);
    expect(v.confidence).toBeCloseTo(0.9);
  });

  it('never reports done when criteria are still unmet', () => {
    const v = parseVisualVerdict('{"done":true,"progress":80,"unmetCriteria":["save not confirmed"]}');
    expect(v.done).toBe(false);
    expect(v.unmetCriteria).toEqual(['save not confirmed']);
  });

  it('never reports done when a blocker is visible', () => {
    const v = parseVisualVerdict('{"done":true,"blockers":["login wall"]}');
    expect(v.done).toBe(false);
    expect(v.blockers).toEqual(['login wall']);
  });

  it('returns a safe inconclusive verdict for non-JSON', () => {
    const v = parseVisualVerdict('the screen looks fine to me');
    expect(v.done).toBe(false);
    expect(v.observation).toMatch(/inconclusive/i);
  });

  it('clamps out-of-range numbers', () => {
    const v = parseVisualVerdict('{"done":false,"progress":250,"confidence":5}');
    expect(v.progress).toBe(100);
    expect(v.confidence).toBe(1);
  });
});

describe('runVisualVerification', () => {
  const fakeCall = (content: string): typeof callOpenRouterJson =>
    (async () => ({ content, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.0001, model: 'test' } })) as unknown as typeof callOpenRouterJson;

  it('is inconclusive when no screenshot is provided', async () => {
    const v = await runVisualVerification({ imageDataUrls: [], criteria: ['x'], goal: 'g', userId: 'u' });
    expect(v.done).toBe(false);
    expect(v.observation).toMatch(/no screenshot/i);
  });

  it('returns the judged verdict and reports cost', async () => {
    const addCost = vi.fn();
    const v = await runVisualVerification({
      imageDataUrls: ['data:image/jpeg;base64,AAA'],
      criteria: ['row visible'],
      goal: 'put a row in the sheet',
      userId: 'u',
      addCost,
      call: fakeCall('{"done":true,"progress":100,"metCriteria":["row visible"],"unmetCriteria":[],"blockers":[]}'),
    });
    expect(v.done).toBe(true);
    expect(addCost).toHaveBeenCalledWith(0.0001);
  });

  it('degrades to inconclusive when the judge throws', async () => {
    const throwing = (async () => { throw new Error('network down'); }) as unknown as typeof callOpenRouterJson;
    const v = await runVisualVerification({
      imageDataUrls: ['data:image/jpeg;base64,AAA'],
      criteria: ['x'],
      goal: 'g',
      userId: 'u',
      call: throwing,
    });
    expect(v.done).toBe(false);
    expect(v.observation).toMatch(/network down/i);
  });

  it('inconclusiveVerdict is never done', () => {
    expect(inconclusiveVerdict('x').done).toBe(false);
  });
});
