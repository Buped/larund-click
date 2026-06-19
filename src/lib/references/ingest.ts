import type { DocumentReference } from './types';
import {
  readDocument,
  readRelevantFromFolder,
  summarizeReadResults,
  formatFolderScan,
} from '../document-reader';
import type { ReadDocumentResult, FolderScanResult } from '../document-reader';

/** A model-ready image content block in OpenRouter/Anthropic shape. */
export interface ImageBlock {
  type: 'image_url';
  image_url: { url: string };
}

/** Per-reference detail so callers (the agent loop) can emit UI steps. */
export interface IngestedReference {
  ref: DocumentReference;
  kind: 'file' | 'folder';
  ok: boolean;
  /** Step output text — folder scan summary or document read summary. */
  output: string;
  error?: string;
  folderScan?: FolderScanResult;
  documentRead?: ReadDocumentResult;
  documents?: ReadDocumentResult[];
}

export interface ReferenceIngest {
  /** Bounded textual content (folder inventories + document excerpts). */
  textBlocks: string[];
  /** Image vision blocks to attach to a multimodal user message. */
  imageBlocks: ImageBlock[];
  /** Per-reference read detail, in input order. */
  perRef: IngestedReference[];
  /** Absolute paths of files whose contents were actually read. */
  filesRead: string[];
}

const MAX_DOC_INJECT_CHARS = 8_000;
const MAX_TOTAL_INJECT_CHARS = 48_000;
/** Cap page images per document (economy: limits vision token cost for scanned PDFs). */
const MAX_VISION_IMAGES = 8;

/**
 * Read attached references (files, folders, images) into model-ready content:
 * text excerpts plus base64 image blocks. Shared by the agent control loop and
 * the normal chat path so both actually send the contents to the model rather
 * than only the labels.
 */
export async function ingestReferences(
  references: DocumentReference[],
  query: string,
): Promise<ReferenceIngest> {
  const textBlocks: string[] = [];
  const imageBlocks: ImageBlock[] = [];
  const perRef: IngestedReference[] = [];
  const filesRead: string[] = [];
  let injectedChars = 0;

  // Fold one read document into the buffers: image → vision block, textual
  // content → bounded text block.
  const ingestDocument = (result: ReadDocumentResult) => {
    const target = result.ref.path ?? result.ref.url ?? result.ref.label;
    // Single image file, or multi-page images from a scanned PDF → vision blocks.
    const pageImages = result.imageDataUrls?.length
      ? result.imageDataUrls
      : result.imageDataUrl
        ? [result.imageDataUrl]
        : [];
    if (pageImages.length) {
      for (const url of pageImages.slice(0, MAX_VISION_IMAGES)) {
        imageBlocks.push({ type: 'image_url', image_url: { url } });
      }
      const scanned = Boolean(result.imageDataUrls?.length);
      textBlocks.push(
        `### ${scanned ? 'Scanned document' : 'Image'}: ${result.ref.label} (${target})\n${
          scanned
            ? `${pageImages.length} page image(s) attached below — read them visually and extract the data.`
            : 'The image is attached below — analyze its visual contents.'
        }`,
      );
      return;
    }
    if (!result.ok) {
      textBlocks.push(`### ${result.ref.label} (${target})\nCould not read: ${result.error ?? 'unknown error'}`);
      return;
    }
    const body = result.contentText ?? (result.structured ? JSON.stringify(result.structured) : '') ?? '';
    if (injectedChars >= MAX_TOTAL_INJECT_CHARS) {
      textBlocks.push(`### ${result.ref.label} (${target})\n[omitted — injection budget reached; read with document.read if needed]`);
      return;
    }
    const remaining = MAX_TOTAL_INJECT_CHARS - injectedChars;
    const slice = body.slice(0, Math.min(MAX_DOC_INJECT_CHARS, remaining));
    injectedChars += slice.length;
    const note = slice.length < body.length ? '\n[…truncated]' : '';
    textBlocks.push(`### ${result.ref.label} (${target})\n${slice || result.summary || '[empty]'}${note}`);
  };

  for (const ref of references) {
    if (ref.kind === 'folder') {
      // Smart, bounded folder analysis: full recursive inventory + read the
      // relevant documents so their contents reach the model context.
      const { scan, documents } = await readRelevantFromFolder(ref, query);
      const output = formatFolderScan(scan);
      perRef.push({ ref, kind: 'folder', ok: scan.ok, output, error: scan.ok ? undefined : scan.error, folderScan: scan, documents });
      textBlocks.push(`## Folder: ${ref.label} (${ref.path ?? ''})\n${output}`);
      for (const doc of documents) {
        if (doc.ok && doc.ref.path) filesRead.push(doc.ref.path);
        ingestDocument(doc);
      }
    } else if (ref.kind === 'file') {
      const result = await readDocument(ref);
      const output = summarizeReadResults([result]);
      if (result.ok && ref.path) filesRead.push(ref.path);
      perRef.push({ ref, kind: 'file', ok: result.ok, output, error: result.ok ? undefined : result.error, documentRead: result });
      ingestDocument(result);
    }
  }

  return { textBlocks, imageBlocks, perRef, filesRead };
}

/**
 * Build the intro-wrapped multimodal content for a user message from ingested
 * references. Returns `null` when there is nothing to attach.
 */
export function buildReferenceMessageContent(
  ingest: ReferenceIngest,
  intro = 'Attached references — analyze these before acting. Do not invent their contents.',
): string | Array<{ type: 'text'; text: string } | ImageBlock> | null {
  if (ingest.textBlocks.length === 0 && ingest.imageBlocks.length === 0) return null;
  const textPart = [intro, ...ingest.textBlocks].join('\n\n');
  return ingest.imageBlocks.length > 0
    ? [{ type: 'text', text: textPart }, ...ingest.imageBlocks]
    : textPart;
}
