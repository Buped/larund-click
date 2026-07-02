import {
  PROJECT_CONTEXT_ERRORS,
  PROJECT_CONTEXT_LIMITS,
  TEXT_SOURCE_EXTENSIONS,
  UNSUPPORTED_BINARY_EXTENSIONS,
} from './limits';
import {
  detectLikelySecrets,
  looksBinary,
  normalizeProjectSourceText,
} from './chunk';

export interface ProjectSourceValidation {
  ok: boolean;
  error?: string;
  extension?: string;
  warnings: string[];
}

export function extensionFromName(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

export function validateProjectSourceFile(file: {
  name: string;
  size: number;
  type?: string;
}): ProjectSourceValidation {
  const extension = extensionFromName(file.name);
  if (UNSUPPORTED_BINARY_EXTENSIONS.has(extension)) {
    return { ok: false, error: 'Only text-based project sources are supported in this version. PDF/DOCX extraction will come later.', extension, warnings: [] };
  }
  if (!TEXT_SOURCE_EXTENSIONS.has(extension)) {
    return { ok: false, error: PROJECT_CONTEXT_ERRORS.textOnly, extension, warnings: [] };
  }
  if (file.size > PROJECT_CONTEXT_LIMITS.maxBytesPerTextFile) {
    return { ok: false, error: PROJECT_CONTEXT_ERRORS.fileTooLarge, extension, warnings: [] };
  }
  const mime = file.type ?? '';
  const knownTextMime = !mime || mime.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(mime);
  if (!knownTextMime) {
    return { ok: false, error: PROJECT_CONTEXT_ERRORS.textOnly, extension, warnings: [] };
  }
  return { ok: true, extension, warnings: [] };
}

export function validateProjectSourceText(text: string): ProjectSourceValidation {
  const normalized = normalizeProjectSourceText(text);
  if (looksBinary(text)) return { ok: false, error: PROJECT_CONTEXT_ERRORS.binary, warnings: [] };
  if (normalized.length > PROJECT_CONTEXT_LIMITS.maxCharsPerSource) {
    return { ok: false, error: PROJECT_CONTEXT_ERRORS.fileTooLarge, warnings: [] };
  }
  return { ok: true, warnings: detectLikelySecrets(normalized) };
}

export async function readTextFile(file: File): Promise<string> {
  const validation = validateProjectSourceFile(file);
  if (!validation.ok) throw new Error(validation.error ?? PROJECT_CONTEXT_ERRORS.textOnly);
  const text = await file.text();
  const textValidation = validateProjectSourceText(text);
  if (!textValidation.ok) throw new Error(textValidation.error ?? PROJECT_CONTEXT_ERRORS.textOnly);
  return normalizeProjectSourceText(text);
}
