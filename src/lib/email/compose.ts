// Pure helpers shared by the email.compose executor and the EmailComposerCard.
// No I/O here — Gmail calls live in gmail-actions.ts.

import type { EmailDraft, EmailSourceChip } from './types';

export function newEmailDraftId(): string {
  return `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function gmailDraftUrl(draftId?: string): string | undefined {
  // Gmail has no per-draft deep link that is stable across accounts; the Drafts
  // view is the reliable target.
  return draftId ? 'https://mail.google.com/mail/u/0/#drafts' : undefined;
}

export function gmailMessageUrl(messageId?: string): string | undefined {
  return messageId ? 'https://mail.google.com/mail/u/0/#sent' : undefined;
}

/** Normalize an arbitrary sources arg into chips. */
export function toSourceChips(value: unknown): EmailSourceChip[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): EmailSourceChip | null => {
      if (typeof item === 'string') return { label: item };
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const label = typeof o.label === 'string' ? o.label : typeof o.title === 'string' ? o.title : undefined;
        if (!label) return null;
        return {
          label,
          kind: typeof o.kind === 'string' ? o.kind : undefined,
          fileId: typeof o.fileId === 'string' ? o.fileId : typeof o.file_id === 'string' ? o.file_id : undefined,
          url: typeof o.url === 'string' ? o.url : undefined,
        };
      }
      return null;
    })
    .filter((c): c is EmailSourceChip => Boolean(c));
}

/** The output marker the verifier/guard look for. Keeps evidence parsing stable. */
export function statusMarker(draft: Pick<EmailDraft, 'status'>): string {
  return `[${draft.status}]`;
}
