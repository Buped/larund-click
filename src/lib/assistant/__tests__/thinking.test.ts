import { describe, expect, it } from 'vitest';
import { moveVisualizationBlocksToAnswer, parseLarundEnvelope, parseThinking, serializeThinking } from '../thinking';

describe('Larund visible thinking envelope', () => {
  it('splits visible thinking from the final answer', () => {
    const parsed = parseLarundEnvelope('<larund_visible_thinking>\nPlan first.\n</larund_visible_thinking>\n<larund_answer>\n## Answer\nDone.</larund_answer>');
    expect(parsed.hasEnvelope).toBe(true);
    expect(parsed.thinking?.content).toBe('Plan first.');
    expect(parsed.answer).toBe('## Answer\nDone.');
  });

  it('streams partial thinking without leaking it into the answer', () => {
    const parsed = parseLarundEnvelope('<larund_visible_thinking>Reading the request');
    expect(parsed.thinking?.content).toBe('Reading the request');
    expect(parsed.answer).toBe('');
  });

  it('falls back to raw content when no envelope is present', () => {
    const parsed = parseLarundEnvelope('Plain answer');
    expect(parsed.hasEnvelope).toBe(false);
    expect(parsed.thinking).toBeUndefined();
    expect(parsed.answer).toBe('Plain answer');
  });

  it('round-trips stored thinking json', () => {
    const raw = serializeThinking({ content: '  Useful summary.  ' });
    expect(parseThinking(raw)?.content).toBe('Useful summary.');
  });

  it('moves visualization blocks from thinking into the final answer', () => {
    const parsed = parseLarundEnvelope(`<larund_visible_thinking>
Planning the answer.
\`\`\`visualization
<svg><text>Chart</text></svg>
\`\`\`
</larund_visible_thinking>
<larund_answer>
Here is the result.
</larund_answer>`);

    expect(parsed.thinking?.content).toBe('Planning the answer.');
    expect(parsed.answer).toContain('Here is the result.');
    expect(parsed.answer).toContain('```visualization');
    expect(parsed.answer).toContain('<svg><text>Chart</text></svg>');
  });

  it('keeps visualization blocks already in the answer unchanged', () => {
    const moved = moveVisualizationBlocksToAnswer('Plan only.', 'Answer.\n\n```visualization\n<svg />\n```');
    expect(moved.thinking).toBe('Plan only.');
    expect(moved.answer).toBe('Answer.\n\n```visualization\n<svg />\n```');
  });
});
