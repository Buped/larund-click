import type { ArtifactKind, ArtifactManifest } from './types';

export interface ChatArtifactAttachment {
  id: string;
  artifactId: string;
  title: string;
  kind: ArtifactKind;
  status: 'rendering' | 'ready' | 'failed' | 'blocked';
  mimeType: string;
  fileName: string;
  displayName: string;
  sizeBytes?: number;
  pageCount?: number;
  slideCount?: number;
  previewUrl?: string;
  thumbnailUrl?: string;
  localPath?: string;
  fileId?: string;
  previewFileId?: string;
  createdAt: string;
  verification?: {
    exists: boolean;
    readable: boolean;
    expectedTextPassed?: boolean;
    warnings: string[];
    errors: string[];
  };
}

export interface ArtifactUiEvent {
  type: 'artifact.rendering' | 'artifact.ready' | 'artifact.failed' | 'artifact.preview.ready';
  artifactId: string;
  messageId: string;
  artifact?: ChatArtifactAttachment;
  error?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  autoOpen?: boolean;
}

export interface ArtifactPreviewState {
  isOpen: boolean;
  selectedArtifactId?: string;
  widthPx?: number;
  mode: 'preview' | 'details' | 'source';
}

export function fileNameFromPath(path?: string): string {
  if (!path) return 'artifact';
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatArtifactCount(artifact: Pick<ChatArtifactAttachment, 'pageCount' | 'slideCount' | 'kind'>): string {
  if (artifact.slideCount) return `${artifact.slideCount} ${artifact.slideCount === 1 ? 'slide' : 'slides'}`;
  if (artifact.pageCount) return `${artifact.pageCount} ${artifact.pageCount === 1 ? 'page' : 'pages'}`;
  return artifact.kind.toUpperCase();
}

export function manifestToChatArtifact(manifest: ArtifactManifest): ChatArtifactAttachment {
  const output = manifest.outputFiles[0];
  const preview = manifest.previewFiles[0];
  const fileName = fileNameFromPath(output?.path);
  const expectedText = manifest.verification.containsExpectedText ?? [];
  return {
    id: `${manifest.id}:${output?.id ?? fileName}`,
    artifactId: manifest.id,
    title: manifest.title,
    kind: manifest.kind,
    status: manifest.status === 'ready' ? 'ready' : manifest.status === 'failed' ? 'failed' : manifest.status === 'blocked' ? 'blocked' : 'rendering',
    mimeType: output?.mimeType ?? 'application/octet-stream',
    fileName,
    displayName: manifest.title || fileName,
    sizeBytes: output?.sizeBytes,
    pageCount: manifest.verification.pageCount,
    slideCount: manifest.verification.slideCount,
    thumbnailUrl: preview?.path,
    localPath: output?.path,
    fileId: output?.id,
    previewFileId: preview?.id,
    createdAt: manifest.createdAt,
    verification: {
      exists: manifest.verification.exists,
      readable: manifest.verification.readable,
      expectedTextPassed: expectedText.length > 0 ? true : undefined,
      warnings: manifest.verification.warnings,
      errors: manifest.verification.errors,
    },
  };
}

export function parseArtifactManifest(raw: string): ArtifactManifest | null {
  try {
    const parsed = JSON.parse(raw) as ArtifactManifest;
    return Array.isArray(parsed.outputFiles) && parsed.verification ? parsed : null;
  } catch {
    return null;
  }
}

export function dedupeArtifacts(items: ChatArtifactAttachment[]): ChatArtifactAttachment[] {
  const map = new Map<string, ChatArtifactAttachment>();
  for (const item of items) map.set(item.id, item);
  return [...map.values()];
}
