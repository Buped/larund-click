export type ScheduledXPostStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface ScheduledXPost {
  id: string;
  userId: string;
  xAccountId?: string;
  content: string;
  mediaRefs: string[];
  scheduledFor: string;
  status: ScheduledXPostStatus;
  createdAt: string;
  updatedAt: string;
  linkedChatSessionId?: string;
  xPostId?: string;
  error?: string;
}

const KEY = 'scheduled_x_posts';

function uuid(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `xpost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  } catch {
    return `xpost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function safeStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readAll(): ScheduledXPost[] {
  const raw = safeStorage()?.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ScheduledXPost[] : [];
  } catch {
    return [];
  }
}

function writeAll(items: ScheduledXPost[]): void {
  safeStorage()?.setItem(KEY, JSON.stringify(items));
}

export function createScheduledXPost(input: {
  userId: string;
  xAccountId?: string;
  content: string;
  mediaRefs?: string[];
  scheduledFor: string;
  linkedChatSessionId?: string;
}): ScheduledXPost {
  const ts = new Date().toISOString();
  const post: ScheduledXPost = {
    id: uuid(),
    userId: input.userId,
    xAccountId: input.xAccountId,
    content: input.content,
    mediaRefs: input.mediaRefs ?? [],
    scheduledFor: input.scheduledFor,
    linkedChatSessionId: input.linkedChatSessionId,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
  };
  writeAll([post, ...readAll()]);
  return post;
}

export function listScheduledXPosts(userId: string, status?: ScheduledXPostStatus): ScheduledXPost[] {
  return readAll()
    .filter((p) => p.userId === userId)
    .filter((p) => !status || p.status === status)
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}

export function cancelScheduledXPost(userId: string, id: string): ScheduledXPost | null {
  const all = readAll();
  const found = all.find((p) => p.id === id && p.userId === userId);
  if (!found) return null;
  if (found.status === 'pending') {
    found.status = 'cancelled';
    found.updatedAt = new Date().toISOString();
    writeAll(all);
  }
  return found;
}

export function updateScheduledXPost(id: string, patch: Partial<Pick<ScheduledXPost, 'status' | 'xPostId' | 'error'>>): ScheduledXPost | null {
  const all = readAll();
  const found = all.find((p) => p.id === id);
  if (!found) return null;
  Object.assign(found, patch, { updatedAt: new Date().toISOString() });
  writeAll(all);
  return found;
}

export function dueScheduledXPosts(now = new Date()): ScheduledXPost[] {
  return readAll().filter((p) => p.status === 'pending' && Date.parse(p.scheduledFor) <= now.getTime());
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerRunning = false;

export function stopXScheduledPostWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

export function startXScheduledPostWorker(userId: string, intervalMs = 60_000): void {
  stopXScheduledPostWorker();
  const tick = () => {
    void processDueXScheduledPosts(userId).catch(() => undefined);
  };
  tick();
  workerTimer = setInterval(tick, Math.max(5_000, intervalMs));
}

export async function processDueXScheduledPosts(userId: string, now = new Date()): Promise<ScheduledXPost[]> {
  if (workerRunning) return [];
  workerRunning = true;
  const processed: ScheduledXPost[] = [];
  try {
    const due = dueScheduledXPosts(now).filter((p) => p.userId === userId);
    if (!due.length) return processed;
    const { createConnectionRegistry } = await import('../../registry');
    const registry = createConnectionRegistry(userId);
    for (const post of due) {
      const result = await registry.call('x', 'x.create_post', {
        text: post.content,
        connectedAccountId: post.xAccountId,
        confirmCost: true,
        media_refs: post.mediaRefs,
      });
      if (result.success) {
        let xPostId: string | undefined;
        try {
          const parsed = JSON.parse(result.output.split('\n\nRead-back:')[0]) as { data?: { id?: string } };
          xPostId = parsed.data?.id;
        } catch {
          xPostId = undefined;
        }
        const updated = updateScheduledXPost(post.id, { status: 'sent', xPostId });
        if (updated) processed.push(updated);
      } else {
        const updated = updateScheduledXPost(post.id, { status: 'failed', error: result.error || result.output || 'X scheduled post failed.' });
        if (updated) processed.push(updated);
      }
    }
    return processed;
  } finally {
    workerRunning = false;
  }
}
