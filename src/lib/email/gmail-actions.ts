// Gmail calls used by the interactive EmailComposerCard (user-driven save/send,
// after the agent loop has ended). The agent-loop path uses ctx.connections in
// the executor; this mirrors it with a fresh per-user registry.

import { createConnectionRegistry, providerRuntimeState } from '../connections/registry';
import type { EmailDraft } from './types';
import { gmailDraftUrl, gmailMessageUrl } from './compose';

export function isGmailConnected(userId: string): boolean {
  return providerRuntimeState('google-workspace', { userId }) === 'connected';
}

function detailString(details: unknown, key: string): string {
  const v = details && typeof details === 'object' ? (details as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/**
 * Create (or re-create) a real Gmail draft from the composer's current fields.
 * Note: there is no update_draft tool yet, so editing then re-saving creates a
 * fresh draft id — the latest one is authoritative.
 */
export async function saveGmailDraft(userId: string, draft: EmailDraft): Promise<EmailDraft> {
  const registry = createConnectionRegistry(userId);
  const res = await registry.call('google-workspace', 'google.gmail.create_draft', {
    to: draft.to,
    cc: draft.cc || undefined,
    bcc: draft.bcc || undefined,
    subject: draft.subject,
    body: draft.body,
  });
  if (!res.success) {
    return { ...draft, status: 'failed', error: res.error ?? res.output ?? 'gmail_draft_failed', updatedAt: new Date().toISOString() };
  }
  const draftId = detailString(res.details, 'draftId') || draft.gmailDraftId;
  return {
    ...draft,
    status: 'gmail_draft_created',
    gmailConnected: true,
    gmailDraftId: draftId,
    webUrl: gmailDraftUrl(draftId) ?? draft.webUrl,
    error: undefined,
    updatedAt: new Date().toISOString(),
  };
}

/** Send the draft via the Gmail API (external_send — approval is gated upstream). */
export async function sendGmailDraft(userId: string, draft: EmailDraft): Promise<EmailDraft> {
  const registry = createConnectionRegistry(userId);
  const args = draft.gmailDraftId
    ? { draftId: draft.gmailDraftId }
    : { to: draft.to, cc: draft.cc || undefined, bcc: draft.bcc || undefined, subject: draft.subject, body: draft.body };
  const res = await registry.call('google-workspace', 'google.gmail.send', args);
  if (!res.success) {
    return { ...draft, status: 'failed', error: res.error ?? res.output ?? 'gmail_send_failed', updatedAt: new Date().toISOString() };
  }
  const messageId = detailString(res.details, 'messageId');
  return {
    ...draft,
    status: 'sent',
    gmailMessageId: messageId,
    webUrl: gmailMessageUrl(messageId) ?? draft.webUrl,
    error: undefined,
    updatedAt: new Date().toISOString(),
  };
}
