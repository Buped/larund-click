import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt } from '../persona';

describe('buildChatSystemPrompt', () => {
  it('identifies Larund without surfacing internal execution limits', () => {
    const p = buildChatSystemPrompt();
    expect(p).toMatch(/Larund/);
    expect(p).toMatch(/AI coworker/i);
    expect(p).toMatch(/Keep internal execution constraints out/i);
    expect(p).not.toMatch(/no-mouse/i);
  });

  it('instructs direct conversational answers (no task plan for chit-chat)', () => {
    const p = buildChatSystemPrompt();
    expect(p).toMatch(/what's your name|what can you do/i);
    expect(p).toMatch(/never with a plan/i);
  });

  it('tells it to reply in the user language', () => {
    expect(buildChatSystemPrompt()).toMatch(/Hungarian in, Hungarian out/i);
  });

  it('requires the visible thinking and answer envelope', () => {
    const p = buildChatSystemPrompt();
    expect(p).toContain('<larund_visible_thinking>');
    expect(p).toContain('<larund_answer>');
    expect(p).toMatch(/Visualization blocks belong in <larund_answer>/i);
  });

  it('folds in custom instructions', () => {
    const p = buildChatSystemPrompt({ customInstructions: 'Always call me Buped.' });
    expect(p).toMatch(/Always call me Buped\./);
    expect(p).toMatch(/CUSTOM INSTRUCTIONS/i);
  });

  it('adds a web-search note when required', () => {
    expect(buildChatSystemPrompt({ webSearch: 'required' })).toMatch(/cite the sources/i);
  });

  it('honors verbosity preference', () => {
    expect(buildChatSystemPrompt({ verbosity: 'concise' })).toMatch(/Keep it short/i);
  });
});
