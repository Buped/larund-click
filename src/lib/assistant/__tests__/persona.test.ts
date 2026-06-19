import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt } from '../persona';

describe('buildChatSystemPrompt', () => {
  it('identifies Larund as a no-mouse coworker', () => {
    const p = buildChatSystemPrompt();
    expect(p).toMatch(/Larund/);
    expect(p).toMatch(/no-mouse/i);
    expect(p).toMatch(/never a mouse/i);
  });

  it('instructs direct conversational answers (no task plan for chit-chat)', () => {
    const p = buildChatSystemPrompt();
    expect(p).toMatch(/what's your name|what can you do/i);
    expect(p).toMatch(/never with a plan/i);
  });

  it('tells it to reply in the user language', () => {
    expect(buildChatSystemPrompt()).toMatch(/Hungarian in, Hungarian out/i);
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
