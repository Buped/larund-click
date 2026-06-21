const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizePathPart(input: string, fallback = 'artifact'): string {
  const cleaned = input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w.\- ]+/g, '-')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!cleaned || RESERVED.test(cleaned)) return fallback;
  return cleaned;
}

export function sanitizeFileName(input: string, extension?: string): string {
  const ext = extension?.replace(/^\./, '');
  const withoutExt = input.replace(/[\\/]/g, '-').replace(/\.[a-z0-9]{1,8}$/i, '');
  const base = sanitizePathPart(withoutExt, 'artifact');
  return ext ? `${base}.${ext}` : base;
}

export function assertSafeRelativePath(path: string): void {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`unsafe_artifact_relative_path:${path}`);
  }
}

export function artifactRelativeOutputPath(fileName: string): string {
  assertSafeRelativePath(fileName);
  return `output/${fileName}`;
}
