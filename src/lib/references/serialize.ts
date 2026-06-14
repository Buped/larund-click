import type { ChatInputPayload, DocumentReference } from './types';

export function serializeReferences(references: DocumentReference[]): string {
  return JSON.stringify(references);
}

export function deserializeReferences(raw: string | null | undefined): DocumentReference[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDocumentReference);
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

function isDocumentReference(value: unknown): value is DocumentReference {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<DocumentReference>;
  return typeof ref.id === 'string'
    && typeof ref.kind === 'string'
    && typeof ref.label === 'string'
    && ref.source === 'user_reference';
}
