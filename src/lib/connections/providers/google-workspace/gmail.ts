import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import {
  GOOGLE_BASE,
  googleApiFetch,
  googleResult,
  base64UrlEncode,
  base64UrlDecode,
  encodeMimeHeader,
} from './client';
import { markdownToEmailHtml, markdownToPlainText } from '../../../email/html';
import { invoke } from '@tauri-apps/api/core';

const GMAIL = `${GOOGLE_BASE}/gmail/v1/users/me`;

function isMock(args: Record<string, unknown>): boolean {
  return args.mock === true || args.__mock === true;
}

interface MockDraft { id: string; to: string; subject: string; body: string; cc?: string; bcc?: string; threadId?: string }
interface MockSent { id: string; to: string; subject: string; body: string; cc?: string; bcc?: string; threadId?: string; labelIds?: string[] }
const mockDrafts = new Map<string, MockDraft>();
const mockSent = new Map<string, MockSent>();
const mockLabels = new Map<string, { id: string; name: string }>([
  ['INBOX', { id: 'INBOX', name: 'INBOX' }],
  ['SENT', { id: 'SENT', name: 'SENT' }],
]);
const mockAttachments = new Map<string, Array<{ attachmentId: string; filename: string; mimeType: string; data: string }>>();
function mockId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Standard (not URL) base64 for a MIME part body; keeps accents via UTF-8. */
function stdBase64(text: string): string {
  return base64UrlEncode(text).replace(/-/g, '+').replace(/_/g, '/');
}

/**
 * Build a base64url-encoded RFC 822 message. Bodies are base64 so accents survive.
 * When `html` is provided, the message is `multipart/alternative` with a plain-text
 * part (fallback) and a styled HTML part; otherwise it is a plain-text message.
 */
export function buildRawMessage(to: string, subject: string, body: string, opts: { cc?: string; bcc?: string; html?: string } = {}): string {
  const headerLines = [
    `To: ${to}`,
    opts.cc ? `Cc: ${opts.cc}` : undefined,
    opts.bcc ? `Bcc: ${opts.bcc}` : undefined,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
  ].filter((line): line is string => line != null);

  let mime: string[];
  if (opts.html) {
    const boundary = `larund_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    mime = [
      ...headerLines,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      stdBase64(body),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      stdBase64(opts.html),
      '',
      `--${boundary}--`,
    ];
  } else {
    mime = [
      ...headerLines,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      stdBase64(body),
    ];
  }
  return base64UrlEncode(mime.join('\r\n'));
}

/**
 * Resolve the plain + HTML parts from a (markdown) body. An explicit `html` arg
 * wins; otherwise HTML is generated from the markdown body so every send/draft
 * goes out beautifully formatted. An empty body stays plain.
 */
function resolveBodyParts(body: string, htmlArg: unknown): { plain: string; html?: string } {
  const hasBody = body.trim().length > 0;
  if (!hasBody) return { plain: body };
  const html = typeof htmlArg === 'string' && htmlArg.trim() ? htmlArg : markdownToEmailHtml(body);
  return { plain: markdownToPlainText(body), html };
}

function decodeMessageBody(payload: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const p = node as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
    if (p.mimeType === 'text/plain' && p.body?.data) parts.push(base64UrlDecode(p.body.data));
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  };
  walk(payload);
  return parts.join('\n').trim();
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
}

function mockMessage(m: MockSent | MockDraft) {
  return {
    id: m.id,
    threadId: m.threadId || m.id,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    from: 'mock-sender@example.com',
    subject: m.subject,
    body: m.body,
    labelIds: 'labelIds' in m ? m.labelIds ?? [] : ['DRAFT'],
  };
}

function allMockMessages(): Array<ReturnType<typeof mockMessage>> {
  return [...mockSent.values(), ...mockDrafts.values()].map(mockMessage);
}

function bytesFromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function collectAttachments(payload: unknown): Array<{ filename: string; mimeType: string; attachmentId: string; size?: number }> {
  const out: Array<{ filename: string; mimeType: string; attachmentId: string; size?: number }> = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const p = node as { filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: unknown[] };
    if (p.filename && p.body?.attachmentId) {
      out.push({ filename: p.filename, mimeType: p.mimeType ?? '', attachmentId: p.body.attachmentId, size: p.body.size });
    }
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  };
  walk(payload);
  return out;
}

export const googleGmailTools: ConnectionToolDefinition[] = [
  {
    name: 'google.gmail.search',
    description: 'Search Gmail messages (Gmail query syntax). Returns id, from, subject, snippet.',
    risk: 'external_read',
    async run(args, secrets) {
      const query = String(args.query ?? args.q ?? '');
      const maxResults = Math.min(Number(args.max_results ?? args.maxResults ?? 10) || 10, 50);
      if (isMock(args)) {
        const items = [...mockSent.values(), ...mockDrafts.values()]
          .filter((m) => !query || `${m.subject} ${m.body} ${m.to}`.toLowerCase().includes(query.toLowerCase()))
          .slice(0, maxResults)
          .map((m) => ({ id: m.id, subject: m.subject, to: m.to, snippet: m.body.slice(0, 80) }));
        return { success: true, output: JSON.stringify({ messages: items, count: items.length }), details: { messages: items } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const list = await googleApiFetch(
          'gmail',
          `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
          auth.accessToken!,
        ) as { messages?: Array<{ id: string }> };
        const ids = (list.messages ?? []).map((m) => m.id);
        const messages = await Promise.all(
          ids.map(async (id) => {
            const msg = await googleApiFetch(
              'gmail',
              `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
              auth.accessToken!,
            ) as { id: string; snippet?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } };
            return {
              id: msg.id,
              from: header(msg.payload?.headers, 'From'),
              subject: header(msg.payload?.headers, 'Subject'),
              snippet: msg.snippet ?? '',
            };
          }),
        );
        return { success: true, output: JSON.stringify({ messages, count: messages.length }), details: { messages } };
      });
    },
  },
  {
    name: 'google.gmail.read_thread',
    description: 'Read a Gmail thread (threadId) or infer the thread from a message id.',
    risk: 'external_read',
    async run(args, secrets) {
      const threadId = String(args.threadId ?? args.thread_id ?? args.id ?? '');
      const messageId = String(args.messageId ?? args.message_id ?? '');
      if (!threadId && !messageId) return { success: false, output: '', error: 'missing_thread_or_message_id' };
      if (isMock(args)) {
        const key = threadId || messageId;
        const messages = allMockMessages().filter((m) => m.threadId === key || m.id === key);
        return { success: true, output: JSON.stringify({ threadId: key, messages, count: messages.length }), details: { threadId: key, messages } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        let resolvedThreadId = threadId;
        if (!resolvedThreadId && messageId) {
          const msg = await googleApiFetch('gmail', `${GMAIL}/messages/${messageId}?format=minimal`, auth.accessToken!) as { threadId?: string };
          resolvedThreadId = String(msg.threadId ?? '');
        }
        if (!resolvedThreadId) return { success: false, output: '', error: 'thread_not_found' };
        const thread = await googleApiFetch('gmail', `${GMAIL}/threads/${resolvedThreadId}?format=full`, auth.accessToken!) as {
          id?: string; messages?: Array<{ id?: string; threadId?: string; snippet?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } }>;
        };
        const messages = (thread.messages ?? []).map((msg) => ({
          id: msg.id,
          threadId: msg.threadId,
          from: header(msg.payload?.headers, 'From'),
          to: header(msg.payload?.headers, 'To'),
          subject: header(msg.payload?.headers, 'Subject'),
          date: header(msg.payload?.headers, 'Date'),
          body: decodeMessageBody(msg.payload) || msg.snippet || '',
        }));
        return { success: true, output: JSON.stringify({ threadId: thread.id ?? resolvedThreadId, messages, count: messages.length }), details: { threadId: thread.id ?? resolvedThreadId, messages } };
      });
    },
  },
  {
    name: 'google.gmail.list_labels',
    description: 'List Gmail labels.',
    risk: 'external_read',
    async run(args, secrets) {
      if (isMock(args)) return { success: true, output: JSON.stringify({ labels: [...mockLabels.values()] }), details: { labels: [...mockLabels.values()] } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const data = await googleApiFetch('gmail', `${GMAIL}/labels`, auth.accessToken!);
        return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
      });
    },
  },
  {
    name: 'google.gmail.create_label',
    description: 'Create a Gmail label and verify it is listed.',
    risk: 'external_write',
    async run(args, secrets) {
      const name = String(args.name ?? args.label ?? '').trim();
      if (!name) return { success: false, output: '', error: 'missing_label_name' };
      if (isMock(args)) {
        const id = `Label_${name.replace(/\W+/g, '_')}`;
        mockLabels.set(id, { id, name });
        return { success: true, output: `Mock Gmail label created: ${name}`, details: { id, name, verified: true } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const created = await googleApiFetch('gmail', `${GMAIL}/labels`, auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
        }) as { id?: string; name?: string };
        const listed = await googleApiFetch('gmail', `${GMAIL}/labels`, auth.accessToken!) as { labels?: Array<{ id?: string; name?: string }> };
        const verified = (listed.labels ?? []).some((l) => l.id === created.id || l.name === name);
        return { success: true, output: `Gmail label created: ${created.name ?? name}. Read-back: ${verified ? 'verified' : 'not verified'}.`, details: { ...created, verified } };
      });
    },
  },
  {
    name: 'google.gmail.modify_labels',
    description: 'Add/remove labels on one or more Gmail messages, then read back label ids.',
    risk: 'external_write',
    async run(args, secrets) {
      const ids = (Array.isArray(args.messageIds) ? args.messageIds : Array.isArray(args.message_ids) ? args.message_ids : [args.messageId ?? args.message_id ?? args.id])
        .map((id) => String(id ?? ''))
        .filter(Boolean);
      const addLabelIds = (Array.isArray(args.addLabelIds) ? args.addLabelIds : Array.isArray(args.add_label_ids) ? args.add_label_ids : []).map(String);
      const removeLabelIds = (Array.isArray(args.removeLabelIds) ? args.removeLabelIds : Array.isArray(args.remove_label_ids) ? args.remove_label_ids : []).map(String);
      if (!ids.length) return { success: false, output: '', error: 'missing_message_ids' };
      if (isMock(args)) {
        for (const id of ids) {
          const m = mockSent.get(id);
          if (!m) continue;
          const current = new Set(m.labelIds ?? []);
          addLabelIds.forEach((label) => current.add(label));
          removeLabelIds.forEach((label) => current.delete(label));
          m.labelIds = [...current];
        }
        return { success: true, output: JSON.stringify({ messageIds: ids, addLabelIds, removeLabelIds, verified: true }), details: { messageIds: ids, addLabelIds, removeLabelIds, verified: true } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        await Promise.all(ids.map((id) => googleApiFetch('gmail', `${GMAIL}/messages/${id}/modify`, auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify({ addLabelIds, removeLabelIds }),
        })));
        const readBack = await Promise.all(ids.map((id) => googleApiFetch('gmail', `${GMAIL}/messages/${id}?format=minimal`, auth.accessToken!) as Promise<{ id?: string; labelIds?: string[] }>));
        const verified = readBack.every((m) => addLabelIds.every((label) => (m.labelIds ?? []).includes(label)) && removeLabelIds.every((label) => !(m.labelIds ?? []).includes(label)));
        return { success: true, output: JSON.stringify({ messageIds: ids, verified, readBack }), details: { messageIds: ids, verified, readBack } };
      });
    },
  },
  {
    name: 'google.gmail.read',
    description: 'Read a full Gmail message (headers + plain-text body).',
    risk: 'external_read',
    async run(args, secrets) {
      const messageId = String(args.message_id ?? args.messageId ?? args.id ?? '');
      if (!messageId) return { success: false, output: '', error: 'missing_message_id' };
      if (isMock(args)) {
        const m = mockSent.get(messageId) ?? mockDrafts.get(messageId);
        return { success: true, output: m ? `${m.subject}\n\n${m.body}` : '', details: { message: m ?? null } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const msg = await googleApiFetch('gmail', `${GMAIL}/messages/${messageId}?format=full`, auth.accessToken!) as {
          id: string; snippet?: string; payload?: { headers?: Array<{ name?: string; value?: string }> };
        };
        const meta = {
          id: msg.id,
          from: header(msg.payload?.headers, 'From'),
          to: header(msg.payload?.headers, 'To'),
          subject: header(msg.payload?.headers, 'Subject'),
          date: header(msg.payload?.headers, 'Date'),
          body: decodeMessageBody(msg.payload),
        };
        return { success: true, output: `${meta.subject}\n\n${meta.body || msg.snippet || ''}`, details: { message: meta } };
      });
    },
  },
  {
    name: 'google.gmail.create_reply_draft',
    description: 'Create a Gmail reply draft in an existing thread.',
    risk: 'external_write',
    async run(args, secrets) {
      const messageId = String(args.messageId ?? args.message_id ?? '');
      const threadId = String(args.threadId ?? args.thread_id ?? '');
      const to = String(args.to ?? '');
      const subjectArg = String(args.subject ?? '');
      const body = String(args.body ?? '');
      if (!messageId && !threadId) return { success: false, output: '', error: 'missing_message_or_thread_id' };
      if (isMock(args)) {
        const original = allMockMessages().find((m) => m.id === messageId || m.threadId === threadId);
        const id = mockId('draft');
        const resolvedThreadId = threadId || original?.threadId || messageId;
        const subject = subjectArg || (original?.subject?.toLowerCase().startsWith('re:') ? original.subject : `Re: ${original?.subject ?? 'Reply'}`);
        mockDrafts.set(id, { id, threadId: resolvedThreadId, to: to || original?.from || 'mock-sender@example.com', subject, body });
        return { success: true, output: `Mock Gmail reply draft created: ${id}`, details: { draftId: id, threadId: resolvedThreadId, verified: true } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        let meta: { threadId?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } } = {};
        if (messageId) {
          meta = await googleApiFetch('gmail', `${GMAIL}/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, auth.accessToken!) as typeof meta;
        }
        const resolvedThreadId = threadId || String(meta.threadId ?? '');
        if (!resolvedThreadId) return { success: false, output: '', error: 'thread_not_found' };
        const subjectRaw = subjectArg || header(meta.payload?.headers, 'Subject') || 'Reply';
        const subject = /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw}`;
        const recipient = to || header(meta.payload?.headers, 'From');
        if (!recipient) return { success: false, output: '', error: 'missing_reply_recipient' };
        const { plain, html } = resolveBodyParts(body, args.html);
        const created = await googleApiFetch('gmail', `${GMAIL}/drafts`, auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify({ message: { raw: buildRawMessage(recipient, subject, plain, { html }), threadId: resolvedThreadId } }),
        }) as { id?: string; message?: { id?: string } };
        const draftId = String(created.id ?? '');
        const verified = draftId ? await googleApiFetch('gmail', `${GMAIL}/drafts/${draftId}?format=metadata`, auth.accessToken!).then(() => true).catch(() => false) : false;
        return { success: true, output: `Gmail reply draft created in thread ${resolvedThreadId}. Read-back: ${verified ? 'verified' : 'not verified'}.`, details: { draftId, threadId: resolvedThreadId, messageId: created.message?.id, verified } };
      });
    },
  },
  {
    name: 'google.gmail.create_draft',
    description: 'Create a Gmail draft (does NOT send).',
    risk: 'external_write',
    async run(args, secrets) {
      const to = String(args.to ?? '');
      const cc = String(args.cc ?? '');
      const bcc = String(args.bcc ?? '');
      const subject = String(args.subject ?? '');
      const body = String(args.body ?? '');
      const threadId = String(args.threadId ?? args.thread_id ?? '');
      if (!to) return { success: false, output: '', error: 'missing_recipient' };
      if (isMock(args)) {
        const id = mockId('draft');
        mockDrafts.set(id, { id, to, cc, bcc, subject, body, threadId });
        return { success: true, output: `Mock draft created: ${id}`, details: { draftId: id, to, subject } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const { plain, html } = resolveBodyParts(body, args.html);
      return googleResult(async () => {
        const created = await googleApiFetch('gmail', `${GMAIL}/drafts`, auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify({ message: { raw: buildRawMessage(to, subject, plain, { cc, bcc, html }), ...(threadId ? { threadId } : {}) } }),
        }) as { id?: string; message?: { id?: string } };
        // Read-back: confirm the draft exists.
        const draftId = String(created.id ?? '');
        const verified = draftId
          ? await googleApiFetch('gmail', `${GMAIL}/drafts/${draftId}?format=metadata`, auth.accessToken!).then(() => true).catch(() => false)
          : false;
        // Echo the full editable draft so the chat can render the composer card
        // even when this tool is called directly (not via email.compose).
        const emailDraft = {
          id: `email-${draftId || Date.now()}`,
          to, cc: cc || undefined, bcc: bcc || undefined, subject, body,
          status: 'gmail_draft_created' as const,
          gmailConnected: true,
          gmailDraftId: draftId,
          webUrl: 'https://mail.google.com/mail/u/0/#drafts',
        };
        return {
          success: true,
          output: `Gmail piszkozat létrehozva (${to} – "${subject}"). Read-back: ${verified ? 'megerősítve' : 'nem megerősíthető'}. [gmail_draft_created]`,
          details: { draftId, messageId: created.message?.id, to, subject, verified, emailDraft },
        };
      });
    },
  },
  {
    name: 'google.gmail.update_draft',
    description: 'Update an existing Gmail draft with a new message body/subject.',
    risk: 'external_write',
    async run(args, secrets) {
      const draftId = String(args.draftId ?? args.draft_id ?? args.id ?? '');
      if (!draftId) return { success: false, output: '', error: 'missing_draft_id' };
      const existing = mockDrafts.get(draftId);
      const to = String(args.to ?? existing?.to ?? '');
      const cc = String(args.cc ?? existing?.cc ?? '');
      const bcc = String(args.bcc ?? existing?.bcc ?? '');
      const subject = String(args.subject ?? existing?.subject ?? '');
      const body = String(args.body ?? existing?.body ?? '');
      const threadId = String(args.threadId ?? args.thread_id ?? existing?.threadId ?? '');
      if (isMock(args)) {
        mockDrafts.set(draftId, { id: draftId, to, cc, bcc, subject, body, threadId });
        return { success: true, output: `Mock Gmail draft updated: ${draftId}`, details: { draftId, verified: true, draft: mockDrafts.get(draftId) } };
      }
      if (!to) return { success: false, output: '', error: 'missing_recipient' };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const { plain, html } = resolveBodyParts(body, args.html);
        const updated = await googleApiFetch('gmail', `${GMAIL}/drafts/${draftId}`, auth.accessToken!, {
          method: 'PUT',
          body: JSON.stringify({ id: draftId, message: { raw: buildRawMessage(to, subject, plain, { cc, bcc, html }), ...(threadId ? { threadId } : {}) } }),
        }) as { id?: string; message?: { id?: string } };
        const verified = await googleApiFetch('gmail', `${GMAIL}/drafts/${draftId}?format=metadata`, auth.accessToken!).then(() => true).catch(() => false);
        return { success: true, output: `Gmail draft updated: ${updated.id ?? draftId}. Read-back: ${verified ? 'verified' : 'not verified'}.`, details: { draftId: updated.id ?? draftId, messageId: updated.message?.id, verified } };
      });
    },
  },
  {
    name: 'google.gmail.list_attachments',
    description: 'List attachments on a Gmail message.',
    risk: 'external_read',
    async run(args, secrets) {
      const messageId = String(args.messageId ?? args.message_id ?? args.id ?? '');
      if (!messageId) return { success: false, output: '', error: 'missing_message_id' };
      if (isMock(args)) {
        const attachments = mockAttachments.get(messageId) ?? [{ attachmentId: 'att-1', filename: 'invoice.pdf', mimeType: 'application/pdf', data: base64UrlEncode('mock attachment') }];
        mockAttachments.set(messageId, attachments);
        return { success: true, output: JSON.stringify({ messageId, attachments }), details: { messageId, attachments } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const msg = await googleApiFetch('gmail', `${GMAIL}/messages/${messageId}?format=full`, auth.accessToken!) as { payload?: unknown };
        const attachments = collectAttachments(msg.payload);
        return { success: true, output: JSON.stringify({ messageId, attachments }), details: { messageId, attachments } };
      });
    },
  },
  {
    name: 'google.gmail.download_attachment',
    description: 'Download a Gmail attachment and optionally write it to targetPath.',
    risk: 'external_read',
    async run(args, secrets) {
      const messageId = String(args.messageId ?? args.message_id ?? '');
      const attachmentId = String(args.attachmentId ?? args.attachment_id ?? '');
      const targetPath = String(args.targetPath ?? args.target_path ?? '');
      if (!messageId || !attachmentId) return { success: false, output: '', error: 'missing_message_or_attachment_id' };
      if (isMock(args)) {
        const attachment = (mockAttachments.get(messageId) ?? []).find((a) => a.attachmentId === attachmentId) ?? { attachmentId, filename: 'attachment.txt', mimeType: 'text/plain', data: base64UrlEncode('mock attachment') };
        const bytes = Array.from(bytesFromBase64Url(attachment.data));
        if (targetPath) await invoke<string>('file_write_bytes', { path: targetPath, bytes });
        return { success: true, output: targetPath ? `Mock Gmail attachment saved to ${targetPath}` : `Mock Gmail attachment downloaded (${bytes.length} bytes)`, details: { messageId, attachmentId, filename: attachment.filename, targetPath, bytes: bytes.length } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const data = await googleApiFetch('gmail', `${GMAIL}/messages/${messageId}/attachments/${attachmentId}`, auth.accessToken!) as { data?: string; size?: number };
        const bytes = data.data ? bytesFromBase64Url(data.data) : new Uint8Array();
        if (targetPath) {
          await invoke<string>('file_write_bytes', { path: targetPath, bytes: Array.from(bytes) });
          return { success: true, output: `Gmail attachment saved to ${targetPath}`, details: { messageId, attachmentId, targetPath, bytes: bytes.length, size: data.size } };
        }
        return { success: true, output: `Gmail attachment downloaded (${bytes.length} bytes)`, details: { messageId, attachmentId, bytes: bytes.length, size: data.size } };
      });
    },
  },
  {
    name: 'google.gmail.send',
    description: 'Send a Gmail message — either an existing draft (draftId) or a new message (to/subject/body). External send: approval-gated.',
    risk: 'external_send',
    async run(args, secrets) {
      const draftId = String(args.draftId ?? args.draft_id ?? '');
      const to = String(args.to ?? '');
      const cc = String(args.cc ?? '');
      const bcc = String(args.bcc ?? '');
      const subject = String(args.subject ?? '');
      const body = String(args.body ?? '');
      const threadId = String(args.threadId ?? args.thread_id ?? '');
      if (!draftId && !to) return { success: false, output: '', error: 'missing_draft_or_recipient' };
      if (isMock(args)) {
        if (draftId) {
          const d = mockDrafts.get(draftId);
          if (!d) return { success: false, output: '', error: 'mock_draft_not_found' };
          mockDrafts.delete(draftId);
          mockSent.set(d.id, d);
          return { success: true, output: `Mock sent draft ${draftId}`, details: { messageId: d.id, verifiedInSent: true } };
        }
        const id = mockId('sent');
        mockSent.set(id, { id, to, cc, bcc, subject, body, threadId });
        return { success: true, output: `Mock sent message ${id}`, details: { messageId: id, verifiedInSent: true } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        let sent: { id?: string };
        if (draftId) {
          sent = await googleApiFetch('gmail', `${GMAIL}/drafts/send`, auth.accessToken!, {
            method: 'POST',
            body: JSON.stringify({ id: draftId }),
          }) as { id?: string };
        } else {
          const { plain, html } = resolveBodyParts(body, args.html);
          sent = await googleApiFetch('gmail', `${GMAIL}/messages/send`, auth.accessToken!, {
            method: 'POST',
            body: JSON.stringify({ raw: buildRawMessage(to, subject, plain, { cc, bcc, html }), ...(threadId ? { threadId } : {}) }),
          }) as { id?: string };
        }
        // The Gmail API returning a message id IS the send confirmation: the
        // message is accepted and queued. The SENT-label read-back is a best-effort
        // *extra* assurance — Gmail is eventually consistent, so the label can lag a
        // beat. We try once, retry once after a short delay, and if it still hasn't
        // surfaced we DO NOT fail the send (that produced false "küldési hiba"
        // reports). Success is keyed on the message id; verification is informational.
        const messageId = String(sent.id ?? '');
        if (!messageId) {
          return { success: false, output: '', error: 'send_no_message_id', details: { verifiedInSent: false } };
        }
        const isInSent = async (): Promise<boolean> => {
          const check = await googleApiFetch('gmail', `${GMAIL}/messages/${messageId}?format=minimal`, auth.accessToken!) as { labelIds?: string[] };
          return (check.labelIds ?? []).includes('SENT');
        };
        let verifiedInSent = await isInSent().catch(() => false);
        if (!verifiedInSent) {
          await new Promise((r) => setTimeout(r, 800));
          verifiedInSent = await isInSent().catch(() => false);
        }
        const emailDraft = {
          id: `email-${messageId}`,
          to, cc: cc || undefined, bcc: bcc || undefined, subject, body,
          status: 'sent' as const,
          gmailConnected: true,
          gmailMessageId: messageId,
          webUrl: 'https://mail.google.com/mail/u/0/#sent',
        };
        return {
          success: true,
          output: verifiedInSent
            ? `Email elküldve${to ? ` (${to})` : ''}. Read-back: a SENT mappában megerősítve. [sent]`
            : `Email elküldve${to ? ` (${to})` : ''} (üzenet-azonosító: ${messageId}). A SENT-megerősítés késik, de a küldés sikeres. [sent]`,
          details: { messageId, verifiedInSent, emailDraft },
        };
      });
    },
  },
];
