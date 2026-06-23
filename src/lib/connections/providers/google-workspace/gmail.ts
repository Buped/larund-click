import type { ConnectionToolDefinition, ConnectionCallResult } from '../../types';
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

const GMAIL = `${GOOGLE_BASE}/gmail/v1/users/me`;

function isMock(args: Record<string, unknown>): boolean {
  return args.mock === true || args.__mock === true;
}

interface MockDraft { id: string; to: string; subject: string; body: string; cc?: string; bcc?: string; threadId?: string }
interface MockSent { id: string; to: string; subject: string; body: string; cc?: string; bcc?: string; threadId?: string }
const mockDrafts = new Map<string, MockDraft>();
const mockSent = new Map<string, MockSent>();
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
        // Read-back: the sent message must carry the SENT label.
        const messageId = String(sent.id ?? '');
        let verifiedInSent = false;
        if (messageId) {
          const check = await googleApiFetch('gmail', `${GMAIL}/messages/${messageId}?format=minimal`, auth.accessToken!) as { labelIds?: string[] };
          verifiedInSent = (check.labelIds ?? []).includes('SENT');
        }
        const emailDraft = {
          id: `email-${messageId || Date.now()}`,
          to, cc: cc || undefined, bcc: bcc || undefined, subject, body,
          status: 'sent' as const,
          gmailConnected: true,
          gmailMessageId: messageId,
          webUrl: 'https://mail.google.com/mail/u/0/#sent',
        };
        const result: ConnectionCallResult = {
          success: verifiedInSent,
          output: verifiedInSent
            ? `Email elküldve${to ? ` (${to})` : ''}. Read-back: a SENT mappában megerősítve. [sent]`
            : 'Az API elfogadta a küldést, de a SENT mappában nem sikerült visszaigazolni — ellenőrizd manuálisan.',
          details: { messageId, verifiedInSent, ...(verifiedInSent ? { emailDraft } : {}) },
        };
        if (!verifiedInSent) result.error = 'send_not_verified_in_sent';
        return result;
      });
    },
  },
];
