import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { ArtifactManifest } from './types';
import type { ChatArtifactAttachment } from './ui';

function bytesToBlobUrl(bytes: unknown, mimeType: string): string {
  const array = bytes instanceof Uint8Array
    ? bytes
    : Array.isArray(bytes)
      ? new Uint8Array(bytes)
      : new Uint8Array(Object.values(bytes as Record<string, number>));
  return URL.createObjectURL(new Blob([array], { type: mimeType }));
}

export async function getArtifactManifest(artifactId: string): Promise<ArtifactManifest> {
  const raw = await invoke<string>('artifact_get_manifest', { artifactId });
  return JSON.parse(raw) as ArtifactManifest;
}

export async function getArtifactFileBlobUrl(artifact: ChatArtifactAttachment): Promise<string> {
  const bytes = await invoke<unknown>('artifact_get_file_bytes', { artifactId: artifact.artifactId, fileId: artifact.fileId ?? null });
  return bytesToBlobUrl(bytes, artifact.mimeType);
}

export async function getArtifactPreviewBlobUrl(artifact: ChatArtifactAttachment): Promise<string | null> {
  try {
    const bytes = await invoke<unknown>('artifact_get_preview_bytes', { artifactId: artifact.artifactId });
    return bytesToBlobUrl(bytes, 'image/png');
  } catch {
    return null;
  }
}

export async function getArtifactText(artifact: ChatArtifactAttachment): Promise<string> {
  return invoke<string>('artifact_get_text', { artifactId: artifact.artifactId });
}

/** Read the structured source model an artifact was rendered from (e.g. the deck model). */
export async function getArtifactSourceModel<T = unknown>(artifactId: string): Promise<T> {
  const raw = await invoke<string>('artifact_get_source_model', { artifactId });
  return JSON.parse(raw) as T;
}

export async function openArtifact(artifact: ChatArtifactAttachment): Promise<string> {
  return invoke<string>('artifact_open', { artifactId: artifact.artifactId, path: null });
}

export async function showArtifactInFolder(artifact: ChatArtifactAttachment): Promise<string> {
  return invoke<string>('artifact_show_in_folder', { artifactId: artifact.artifactId });
}

export async function saveArtifactCopy(artifact: ChatArtifactAttachment): Promise<string | null> {
  const selected = await save({
    defaultPath: artifact.fileName,
    filters: [{ name: artifact.kind.toUpperCase(), extensions: [artifact.kind] }],
  });
  if (!selected) return null;
  return invoke<string>('artifact_save_copy', { artifactId: artifact.artifactId, targetPath: selected });
}

export async function copyArtifactPath(artifact: ChatArtifactAttachment): Promise<void> {
  if (!artifact.localPath) return;
  await navigator.clipboard.writeText(artifact.localPath);
}
