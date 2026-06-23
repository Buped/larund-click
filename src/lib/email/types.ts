// Chat email composer model. An EmailDraft is surfaced by the agent (email.compose)
// and rendered as an editable card in chat. Its status is the single source of
// truth for what actually happened — a `local_draft` is NEVER a Gmail draft, and
// only `sent` (with a provider message id) counts as a sent email.

export type EmailDraftStatus =
  | 'local_draft'          // composed in chat, Gmail NOT connected / not yet saved
  | 'gmail_draft_created'  // a real Gmail draft exists (gmailDraftId set)
  | 'needs_review'         // waiting for the user to review/edit
  | 'approval_required'    // user pressed Send; awaiting confirm
  | 'sending'              // send in flight
  | 'sent'                 // confirmed sent (gmailMessageId set)
  | 'failed';              // a Gmail API call failed

export interface EmailSourceChip {
  label: string;
  kind?: string;
  fileId?: string;
  url?: string;
}

export interface EmailDraft {
  id: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  status: EmailDraftStatus;
  /** Whether a Google Workspace/Gmail connection was available when composed. */
  gmailConnected: boolean;
  gmailDraftId?: string;
  gmailMessageId?: string;
  /** Deep link to the draft/sent message in the Gmail web UI, when known. */
  webUrl?: string;
  sources?: EmailSourceChip[];
  error?: string;
  updatedAt?: string;
}
