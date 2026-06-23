import type { ChatInputPayload, DocumentReference } from './types';
import type { MentionKind, ReferencedContext } from '../mentions/types';

export type StoredReference = DocumentReference | ReferencedContext;

export function serializeReferences(references: StoredReference[]): string {
  return JSON.stringify(references);
}

export function deserializeReferences(raw: string | null | undefined): StoredReference[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeReference).filter((x): x is StoredReference => Boolean(x));
  } catch {
    return [];
  }
}

export function createChatInputPayload(text: string, references: DocumentReference[]): ChatInputPayload {
  return { text, references };
}

export function renderReferenceMarkdown(ref: DocumentReference): string {
  const target = ref.path ?? ref.url ?? ref.label;
  return `[${ref.label}](${ref.kind}:${target})`;
}

export function appendReferenceSummary(text: string, references: DocumentReference[]): string {
  if (references.length === 0) return text;
  return `${text}\n\nReferenced inputs:\n${references.map((r) => `- ${r.id}: ${r.kind} "${r.label}" ${r.path ?? r.url ?? ''}`.trim()).join('\n')}`;
}

function normalizeReference(value: unknown): StoredReference | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Partial<DocumentReference & ReferencedContext>;
  if (isMentionKind(ref.kind) && typeof ref.id === 'string' && typeof ref.label === 'string' && typeof ref.refId === 'string') {
    return {
      id: ref.id,
      kind: ref.kind,
      label: ref.label,
      refId: typeof ref.refId === 'string' ? ref.refId : (ref.path ?? ref.url ?? ref.id),
      displayText: typeof ref.displayText === 'string' ? ref.displayText : `@${ref.label}`,
      metadata: ref.metadata,
      snapshot: ref.snapshot,
      insertedAt: ref.insertedAt ?? new Date().toISOString(),
      status: ref.status ?? 'available',
      resolvedAtSendTime: ref.resolvedAtSendTime ?? true,
    };
  }
  if (isDocumentReference(value)) return value;
  return null;
}

function isMentionKind(kind: unknown): kind is MentionKind {
  return kind === 'skill' || kind === 'connection' || kind === 'mcp' || kind === 'memory' || kind === 'workflow' || kind === 'file' || kind === 'folder' || kind === 'drive_file' || kind === 'drive_folder';
}

function isDocumentReference(value: unknown): value is DocumentReference {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<DocumentReference>;
  return typeof ref.id === 'string'
    && typeof ref.kind === 'string'
    && typeof ref.label === 'string'
    && (ref.source === 'user_reference' || ref.source === 'connection' || ref.source === 'tool_result');
}
