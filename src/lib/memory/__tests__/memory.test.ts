import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import {
  archiveMemory,
  createMemory,
  deleteMemory,
  getRelevantMemory,
  listMemory,
  searchMemory,
} from '../store';
import { rankMemories, scoreMemory } from '../retriever';
import { renderRelevantMemory } from '../prompt';
import { extractMemoryCandidates } from '../extractor';
import type { MemoryEntry } from '../types';

beforeEach(() => {
  resetRecordBackendForTests();
});

function entry(partial: Partial<MemoryEntry>): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? 'm1',
    userId: 'u1',
    type: 'preference',
    title: 'Title',
    content: 'Content',
    tags: [],
    source: 'user',
    confidence: 0.9,
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe('memory scoring', () => {
  it('scores tag matches highest', () => {
    const e = entry({ tags: ['invoices'], title: 'x', content: 'y' });
    expect(scoreMemory(e, 'process the invoices today')).toBeGreaterThan(4);
  });

  it('gives zero for archived entries', () => {
    const e = entry({ archived: true, tags: ['invoices'] });
    expect(scoreMemory(e, 'invoices')).toBe(0);
  });

  it('boosts pinned entries even on weak match', () => {
    const pinned = entry({ id: 'p', pinned: true, title: 'zzz', content: 'zzz', tags: [] });
    expect(scoreMemory(pinned, 'something unrelated')).toBeGreaterThan(0);
  });

  it('prefers same-workspace memory', () => {
    const inWs = entry({ id: 'a', workspaceId: 'ws1', content: 'deploy pipeline' });
    const otherWs = entry({ id: 'b', workspaceId: 'ws2', content: 'deploy pipeline' });
    const sIn = scoreMemory(inWs, 'deploy pipeline', { workspaceId: 'ws1' });
    const sOther = scoreMemory(otherWs, 'deploy pipeline', { workspaceId: 'ws1' });
    expect(sIn).toBeGreaterThan(sOther);
  });

  it('ranks and limits', () => {
    const entries = [
      entry({ id: 'a', tags: ['alpha'] }),
      entry({ id: 'b', tags: ['beta'] }),
      entry({ id: 'c', content: 'nothing relevant here', tags: [] }),
    ];
    const ranked = rankMemories(entries, 'alpha task', { limit: 1 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].entry.id).toBe('a');
  });
});

describe('memory store + scoping', () => {
  it('creates, lists and scopes by workspace', async () => {
    await createMemory({ userId: 'u1', type: 'preference', title: 'global', content: 'g' });
    await createMemory({ userId: 'u1', workspaceId: 'ws1', type: 'workspace', title: 'wsmem', content: 'w' });
    await createMemory({ userId: 'u1', workspaceId: 'ws2', type: 'workspace', title: 'other', content: 'o' });

    const scoped = await listMemory({ userId: 'u1', workspaceId: 'ws1' });
    const titles = scoped.map((e) => e.title).sort();
    // global (no workspace) + ws1 memory, but not ws2.
    expect(titles).toEqual(['global', 'wsmem']);
  });

  it('does not leak other users memory', async () => {
    await createMemory({ userId: 'u1', type: 'preference', title: 'mine', content: 'x' });
    await createMemory({ userId: 'u2', type: 'preference', title: 'theirs', content: 'y' });
    const list = await listMemory({ userId: 'u1' });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('mine');
  });

  it('archives and deletes', async () => {
    const m = await createMemory({ userId: 'u1', type: 'preference', title: 't', content: 'c' });
    await archiveMemory(m.id);
    expect(await listMemory({ userId: 'u1' })).toHaveLength(0);
    expect(await listMemory({ userId: 'u1', includeArchived: true })).toHaveLength(1);
    await deleteMemory(m.id);
    expect(await listMemory({ userId: 'u1', includeArchived: true })).toHaveLength(0);
  });

  it('search and getRelevantMemory work end to end', async () => {
    await createMemory({
      userId: 'u1',
      type: 'preference',
      title: 'Verify outputs',
      content: 'Always verify file outputs by reading them back.',
      tags: ['verify', 'files'],
    });
    expect(await searchMemory('verify', { userId: 'u1' })).toHaveLength(1);
    const relevant = await getRelevantMemory({ task: 'create a file and verify it', userId: 'u1' });
    expect(relevant.length).toBeGreaterThan(0);
    expect(renderRelevantMemory(relevant)).toMatch(/Relevant memory/);
  });
});

describe('memory extraction', () => {
  it('extracts a preference candidate', () => {
    const c = extractMemoryCandidates({ userId: 'u1', userText: 'I always prefer dark mode reports.' });
    expect(c.some((x) => x.type === 'preference')).toBe(true);
  });

  it('extracts a correction candidate', () => {
    const c = extractMemoryCandidates({ userId: 'u1', userText: "No, that's wrong, you forgot the totals." });
    expect(c.some((x) => x.type === 'correction')).toBe(true);
  });

  it('stays quiet on neutral text', () => {
    const c = extractMemoryCandidates({ userId: 'u1', userText: 'Open the dashboard please.' });
    expect(c).toHaveLength(0);
  });
});
