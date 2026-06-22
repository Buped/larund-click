import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

// In-memory chat DB so create_new can actually create a session and we can assert
// how many times createSession is called.
vi.mock('../../database', () => {
  const sessions = new Map<string, { id: string; title: string; project_id: string | null }>();
  return {
    createSession: vi.fn(async (id: string, title: string, projectId?: string | null) => {
      sessions.set(id, { id, title, project_id: projectId ?? null });
    }),
    getSessionById: vi.fn(async (id: string) => sessions.get(id) ?? null),
    getSessions: vi.fn(async () => [...sessions.values()]),
    addMessage: vi.fn(async () => undefined),
    updateMessage: vi.fn(async () => undefined),
    touchSession: vi.fn(async () => undefined),
    __sessions: sessions,
  };
});

import * as db from '../../database';
import { createAutomation, getAutomation, updateAutomation } from '../store';
import {
  createAutomationLinkedChat,
  effectiveChatMode,
  ensureAutomationChatSession,
} from '../chat-bridge';
import { stopAllAutomationTimers } from '../scheduler';
import type { Automation } from '../types';

const createSessionMock = db.createSession as unknown as Mock;

function fakeAutomation(patch: Partial<Automation>): Automation {
  const now = new Date().toISOString();
  return {
    id: 'auto-x', userId: 'u1', name: 'X', enabled: true,
    trigger: { kind: 'manual' }, taskTemplate: { prompt: 'p' },
    autonomyMode: 'semi', approvalPolicy: {}, status: 'active',
    createdAt: now, updatedAt: now, ...patch,
  };
}

beforeEach(() => {
  resetRecordBackendForTests();
  stopAllAutomationTimers();
  (db as unknown as { __sessions: Map<string, unknown> }).__sessions.clear();
  createSessionMock.mockClear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => undefined);
});

afterEach(() => stopAllAutomationTimers());

describe('effectiveChatMode backfill', () => {
  it('defaults to create_new when no mode and no linked session', () => {
    expect(effectiveChatMode({})).toBe('create_new');
  });
  it('infers append_to_existing when a session was linked but mode is missing', () => {
    expect(effectiveChatMode({ linkedChatSessionId: 's1' })).toBe('append_to_existing');
  });
  it('respects an explicit mode', () => {
    expect(effectiveChatMode({ chatMode: 'none', linkedChatSessionId: 's1' })).toBe('none');
  });
});

describe('ensureAutomationChatSession', () => {
  it('returns null and never creates for chatMode none', async () => {
    const result = await ensureAutomationChatSession(fakeAutomation({ chatMode: 'none' }));
    expect(result).toBeNull();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('append_to_existing without a session returns null and creates nothing', async () => {
    const result = await ensureAutomationChatSession(fakeAutomation({ chatMode: 'append_to_existing' }));
    expect(result).toBeNull();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('append_to_existing reuses an existing session and never creates a new one', async () => {
    await createAutomationLinkedChat({ automationName: 'pre', projectId: null }); // seeds one session
    const existing = [...(db as unknown as { __sessions: Map<string, { id: string }> }).__sessions.values()][0];
    createSessionMock.mockClear();
    const result = await ensureAutomationChatSession(fakeAutomation({ chatMode: 'append_to_existing', linkedChatSessionId: existing.id }));
    expect(result).toBe(existing.id);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('create_new reuses an existing linked session (at most one chat per automation)', async () => {
    const created = await createAutomationLinkedChat({ automationName: 'dedicated', projectId: null });
    createSessionMock.mockClear();
    const result = await ensureAutomationChatSession(fakeAutomation({ chatMode: 'create_new', linkedChatSessionId: created!.sessionId }));
    expect(result).toBe(created!.sessionId);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('create_new recreates when the linked chat was deleted; append_to_existing does not', async () => {
    const createNew = await ensureAutomationChatSession(fakeAutomation({ chatMode: 'create_new', linkedChatSessionId: 'gone-1' }));
    expect(createNew).toBeTruthy();
    expect(createNew).not.toBe('gone-1');

    createSessionMock.mockClear();
    const append = await ensureAutomationChatSession(fakeAutomation({ chatMode: 'append_to_existing', linkedChatSessionId: 'gone-2' }));
    expect(append).toBeNull();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

describe('store persistence of chat config', () => {
  it('defaults a new automation to create_new and creates exactly one dedicated chat', async () => {
    const a = await createAutomation({ userId: 'u1', name: 'Numbers', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'p' } });
    expect(a.chatMode).toBe('create_new');
    expect(a.linkedChatSessionId).toBeTruthy();
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it('chatMode none does not create or link a chat', async () => {
    const a = await createAutomation({ userId: 'u1', name: 'Quiet', chatMode: 'none', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'p' } });
    expect(a.chatMode).toBe('none');
    expect(a.linkedChatSessionId).toBeUndefined();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('append_to_existing keeps the chosen session and never creates a new chat', async () => {
    const a = await createAutomation({ userId: 'u1', name: 'Attached', chatMode: 'append_to_existing', linkedChatSessionId: 'chosen-1', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'p' } });
    expect(a.chatMode).toBe('append_to_existing');
    expect(a.linkedChatSessionId).toBe('chosen-1');
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('changing only chat config does not damage trigger/steps/prompt', async () => {
    const a = await createAutomation({
      userId: 'u1', name: 'Keep', chatMode: 'none',
      trigger: { kind: 'folder_watch', path: 'C:/in', pattern: '*.pdf' },
      taskTemplate: { prompt: 'do it' }, prompt: 'do it',
      steps: [{ id: 's1', title: 'Step', instruction: 'go', referencedContext: [], required: true, order: 0 }],
    });
    await updateAutomation(a.id, { chatMode: 'append_to_existing', linkedChatSessionId: 'chosen-2' });
    const after = await getAutomation(a.id);
    expect(after?.chatMode).toBe('append_to_existing');
    expect(after?.linkedChatSessionId).toBe('chosen-2');
    expect(after?.trigger).toEqual({ kind: 'folder_watch', path: 'C:/in', pattern: '*.pdf' });
    expect(after?.steps?.[0]?.instruction).toBe('go');
    expect(after?.prompt).toBe('do it');
  });
});
