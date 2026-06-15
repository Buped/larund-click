import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import {
  acceptMemorySuggestion,
  createMemory,
  detectDuplicates,
  exportMemory,
  getRelevantMemory,
  importMemory,
  listMemory,
  listSuggestions,
  markContradiction,
  mergeMemories,
  rejectMemorySuggestion,
  suggestMemory,
  supersedeMemory,
} from '../store';
import { generateSuggestions } from '../suggester';

beforeEach(() => {
  resetRecordBackendForTests();
});

describe('memory suggestion pipeline', () => {
  const task = {
    taskRunId: 'task-1',
    userId: 'u1',
    workspaceId: 'ws1',
    title: 'Create Google Sheet with sales data',
    originalPrompt: 'create a google sheet and fill it',
    summary: 'Created sheet and verified 5 rows',
    status: 'completed',
  };

  it('creates a high-priority correction suggestion from a correction', () => {
    const suggestions = generateSuggestions(
      { ...task, corrections: ['No, opening the sheet is not enough, you must write and read back values'] },
      [],
    );
    const correction = suggestions.find((s) => s.type === 'correction');
    expect(correction).toBeTruthy();
    expect(correction?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(correction?.status).toBeUndefined(); // draft; status applied by suggestMemory
  });

  it('creates an evidence suggestion only for verified outcomes', () => {
    const verified = generateSuggestions(task, [
      { id: 'e1', kind: 'verification', title: 'Verification passed', content: 'ok', success: true },
      { id: 'e2', kind: 'file_output', title: 'Output', content: 'sheet.xlsx', success: true },
    ]);
    expect(verified.some((s) => s.type === 'evidence')).toBe(true);

    const unverified = generateSuggestions(task, []);
    expect(unverified.some((s) => s.type === 'evidence')).toBe(false);
  });

  it('extracts preference from user words', () => {
    const s = generateSuggestions({ ...task, userText: 'I always prefer specific marketing copy, not generic text.' }, []);
    expect(s.some((x) => x.type === 'preference')).toBe(true);
  });

  it('stays bounded (max 5)', () => {
    const s = generateSuggestions(
      { ...task, corrections: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], userText: 'I always prefer X' },
      [{ id: 'e1', kind: 'verification', title: 'v', content: 'ok', success: true }],
    );
    expect(s.length).toBeLessThanOrEqual(5);
  });
});

describe('memory review lifecycle', () => {
  it('suggested memory is not used in prompts; accepted memory is', async () => {
    const s = await suggestMemory({
      userId: 'u1', workspaceId: 'ws1', type: 'preference',
      title: 'Use bold copy', content: 'Prefer bold marketing copy for campaigns',
    });
    expect(s.status).toBe('suggested');

    let relevant = await getRelevantMemory({ task: 'write marketing copy', userId: 'u1', workspaceId: 'ws1' });
    expect(relevant.find((r) => r.entry.id === s.id)).toBeUndefined();

    await acceptMemorySuggestion(s.id, { scope: 'workspace' });
    relevant = await getRelevantMemory({ task: 'write marketing copy campaigns', userId: 'u1', workspaceId: 'ws1' });
    expect(relevant.find((r) => r.entry.id === s.id)).toBeTruthy();
  });

  it('rejected memory is not used and not listed by default', async () => {
    const s = await suggestMemory({ userId: 'u1', type: 'preference', title: 't', content: 'rejected content here' });
    await rejectMemorySuggestion(s.id);
    expect(await listMemory({ userId: 'u1' })).toHaveLength(0);
    const relevant = await getRelevantMemory({ task: 'rejected content', userId: 'u1' });
    expect(relevant).toHaveLength(0);
  });

  it('review queue lists suggested + needs_review', async () => {
    await suggestMemory({ userId: 'u1', type: 'preference', title: 'a', content: 'aa' });
    await createMemory({ userId: 'u1', type: 'preference', title: 'b', content: 'bb' }); // active
    expect(await listSuggestions('u1')).toHaveLength(1);
  });
});

describe('memory operations', () => {
  it('supersede archives the old entry', async () => {
    const oldM = await createMemory({ userId: 'u1', type: 'preference', title: 'old', content: 'old style' });
    const newM = await createMemory({ userId: 'u1', type: 'preference', title: 'new', content: 'new style' });
    await supersedeMemory(oldM.id, newM.id);
    const active = await listMemory({ userId: 'u1' });
    expect(active.map((m) => m.id)).toEqual([newM.id]);
  });

  it('markContradiction moves both to needs_review', async () => {
    const a = await createMemory({ userId: 'u1', type: 'preference', title: 'a', content: 'likes blue' });
    const b = await createMemory({ userId: 'u1', type: 'preference', title: 'b', content: 'likes red' });
    await markContradiction(a.id, b.id);
    expect(await listSuggestions('u1')).toHaveLength(2);
  });

  it('merge combines content and archives others', async () => {
    const a = await createMemory({ userId: 'u1', type: 'preference', title: 'a', content: 'alpha', tags: ['x'] });
    const b = await createMemory({ userId: 'u1', type: 'preference', title: 'b', content: 'beta', tags: ['y'] });
    const merged = await mergeMemories(a.id, [b.id]);
    expect(merged?.content).toMatch(/alpha/);
    expect(merged?.content).toMatch(/beta/);
    expect(merged?.tags).toEqual(expect.arrayContaining(['x', 'y']));
    expect(await listMemory({ userId: 'u1' })).toHaveLength(1);
  });

  it('detects duplicates by token overlap', async () => {
    await createMemory({ userId: 'u1', type: 'preference', title: 'Verify outputs', content: 'always verify file outputs by reading them back' });
    await createMemory({ userId: 'u1', type: 'preference', title: 'Verify outputs', content: 'always verify file outputs by reading them back again' });
    await createMemory({ userId: 'u1', type: 'project', title: 'Unrelated', content: 'completely different subject matter entirely' });
    const groups = await detectDuplicates('u1');
    expect(groups.length).toBe(1);
    expect(groups[0].length).toBe(2);
  });

  it('exports and imports memory JSON', async () => {
    await createMemory({ userId: 'u1', type: 'preference', title: 'keep', content: 'important fact' });
    const json = await exportMemory('u1');
    resetRecordBackendForTests();
    const count = await importMemory('u2', json);
    expect(count).toBe(1);
    expect(await listMemory({ userId: 'u2' })).toHaveLength(1);
  });
});

describe('scope filtering', () => {
  it('filters by scope', async () => {
    await createMemory({ userId: 'u1', type: 'preference', title: 'g', content: 'global', scope: 'global' });
    await createMemory({ userId: 'u1', workspaceId: 'ws1', type: 'workspace', title: 'w', content: 'ws', scope: 'workspace' });
    expect(await listMemory({ userId: 'u1', scope: 'global' })).toHaveLength(1);
    expect(await listMemory({ userId: 'u1', scope: 'workspace' })).toHaveLength(1);
  });
});
