import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the connection registry and the model call before importing the module.
const callMock = vi.hoisted(() => vi.fn());
const openRouterMock = vi.hoisted(() => vi.fn());
vi.mock('../../connections/registry', () => ({
  createConnectionRegistry: () => ({ call: callMock, isConfigured: () => true }),
}));
vi.mock('../../openrouter', () => ({ callOpenRouterJson: openRouterMock }));

import { triageInbox, applyTriageLabels } from '../triage';

beforeEach(() => {
  callMock.mockReset();
  openRouterMock.mockReset();
});

describe('triageInbox', () => {
  it('maps model output onto inbox messages', async () => {
    callMock.mockResolvedValueOnce({
      success: true,
      details: { messages: [
        { id: 'm1', from: 'Anna <a@x.hu>', subject: 'Számla', snippet: 'csatolva' },
        { id: 'm2', from: 'Bob <b@x.hu>', subject: 'Hírlevél', snippet: 'heti' },
      ] },
    });
    openRouterMock.mockResolvedValueOnce({
      content: JSON.stringify([
        { index: 0, category: 'Számla', priority: 'high', summary: 'Befizetendő számla.', suggestedLabel: 'Számlák' },
        { index: 1, category: 'Hírlevél', priority: 'low', summary: 'Heti hírlevél.', suggestedLabel: 'Hírlevél' },
      ]),
      usage: {},
    });

    const res = await triageInbox('u1');
    expect(res.error).toBeUndefined();
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toMatchObject({ id: 'm1', priority: 'high', suggestedLabel: 'Számlák' });
    expect(res.items[1].priority).toBe('low');
  });

  it('falls back to neutral defaults when the model is offline', async () => {
    callMock.mockResolvedValueOnce({ success: true, details: { messages: [{ id: 'm1', subject: 'X' }] } });
    openRouterMock.mockRejectedValueOnce(new Error('offline'));
    const res = await triageInbox('u1');
    expect(res.items).toHaveLength(1);
    expect(res.items[0].priority).toBe('medium');
    expect(res.error).toContain('triage_model_failed');
  });

  it('surfaces a search failure without calling the model', async () => {
    callMock.mockResolvedValueOnce({ success: false, error: 'not_connected' });
    const res = await triageInbox('u1');
    expect(res.items).toHaveLength(0);
    expect(res.error).toBe('not_connected');
    expect(openRouterMock).not.toHaveBeenCalled();
  });
});

describe('applyTriageLabels', () => {
  it('ensures labels exist then applies them, grouped by label', async () => {
    callMock.mockImplementation(async (_p: string, tool: string, args: Record<string, unknown>) => {
      if (tool === 'google.gmail.list_labels') return { success: true, details: { labels: [{ id: 'L_OLD', name: 'Régi' }] } };
      if (tool === 'google.gmail.create_label') return { success: true, details: { id: `L_${String(args.name)}` } };
      if (tool === 'google.gmail.modify_labels') return { success: true, details: {} };
      return { success: false, error: 'unexpected' };
    });

    const res = await applyTriageLabels('u1', [
      { id: 'm1', suggestedLabel: 'Számlák' },
      { id: 'm2', suggestedLabel: 'Számlák' },
      { id: 'm3', suggestedLabel: 'Hírlevél' },
    ]);
    expect(res.applied).toBe(3);
    expect(res.errors).toHaveLength(0);
    // create_label called once per distinct new label (Számlák, Hírlevél).
    const created = callMock.mock.calls.filter((c) => c[1] === 'google.gmail.create_label');
    expect(created).toHaveLength(2);
  });
});
