import type { DocumentReference } from '../../lib/references/types';
import type { MentionKind, ReferencedContext } from '../../lib/mentions/types';

export type ComposerReference = ReferencedContext;

export function documentReferenceToMention(ref: DocumentReference): ReferencedContext {
  const kind: MentionKind = ref.kind === 'folder' ? 'folder' : 'file';
  return {
    id: ref.id,
    kind,
    label: ref.label,
    refId: ref.path ?? ref.url ?? ref.id,
    displayText: `@${ref.label}`,
    metadata: { documentReference: ref },
    insertedAt: new Date().toISOString(),
    status: 'available',
    resolvedAtSendTime: true,
  };
}

export function mentionToDocumentReference(ref: ReferencedContext): DocumentReference | null {
  const doc = ref.metadata?.documentReference;
  if (doc && typeof doc === 'object') return doc as DocumentReference;
  if (ref.kind !== 'file' && ref.kind !== 'folder') return null;
  return {
    id: ref.id,
    kind: ref.kind,
    label: ref.label,
    path: ref.refId,
    source: 'user_reference',
  };
}

export function serializeMentionReferences(references: ReferencedContext[]): string {
  return JSON.stringify(references);
}

export function deserializeMentionReferences(raw: string | null | undefined): ReferencedContext[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeReference(item)).filter((x): x is ReferencedContext => Boolean(x));
  } catch {
    return [];
  }
}

function normalizeReference(value: unknown): ReferencedContext | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Partial<ReferencedContext> & Partial<DocumentReference>;
  if (isMentionKind(ref.kind) && typeof ref.id === 'string' && typeof ref.label === 'string') {
    return {
      id: ref.id,
      kind: ref.kind,
      label: ref.label,
      refId: typeof ref.refId === 'string' ? ref.refId : (ref.path ?? ref.url ?? ref.id),
      displayText: typeof ref.displayText === 'string' ? ref.displayText : `@${ref.label}`,
      metadata: ref.metadata,
      snapshot: ref.snapshot,
      insertedAt: typeof ref.insertedAt === 'string' ? ref.insertedAt : new Date().toISOString(),
      status: ref.status ?? 'available',
      resolvedAtSendTime: ref.resolvedAtSendTime ?? true,
    };
  }
  if ((ref.kind === 'file' || ref.kind === 'folder') && typeof ref.id === 'string' && typeof ref.label === 'string') {
    return documentReferenceToMention(ref as DocumentReference);
  }
  return null;
}

function isMentionKind(kind: unknown): kind is MentionKind {
  return kind === 'skill' || kind === 'connection' || kind === 'mcp' || kind === 'memory' || kind === 'workflow' || kind === 'file' || kind === 'folder';
}
