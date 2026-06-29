import { describe, expect, it } from 'vitest';
import { performControlAction } from '../executor';
import type { ToolContext } from '../../tools/types';

const ctx = {
  userId: 'u1',
  sessionId: 's1',
  workspaceRoot: '/',
  task: 'render chart',
  audit: { record: () => undefined, list: () => [] },
  approvals: { request: async () => true, grantAlways: () => undefined },
} satisfies ToolContext;

describe('visualization.render', () => {
  it('returns sanitized static visualization details', async () => {
    const result = await performControlAction({
      action: 'visualization.render',
      title: 'Demo',
      height: 360,
      html: '<div onclick="x()"><script>alert(1)</script><svg><text>népesség</text></svg><form></form></div>',
    }, ctx);

    expect(result.success).toBe(true);
    const visualization = result.details?.visualization as { title?: string; html?: string; height?: number };
    expect(visualization.title).toBe('Demo');
    expect(visualization.height).toBe(360);
    expect(visualization.html).toContain('népesség');
    expect(visualization.html).not.toMatch(/script|onclick|form/i);
  });
});
