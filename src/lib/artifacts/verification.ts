import { invoke } from '@tauri-apps/api/core';
import type { ArtifactKind, ArtifactManifest, ArtifactVerification } from './types';

export async function verifyArtifact(path: string, expectedText: string[] = [], expectedKind?: ArtifactKind): Promise<ArtifactVerification> {
  const raw = await invoke<string>('artifact_verify', { path, expectedText, expectedKind: expectedKind ?? null });
  return JSON.parse(raw) as ArtifactVerification;
}

export async function listArtifacts(workspaceId?: string, taskId?: string): Promise<ArtifactManifest[]> {
  const raw = await invoke<string>('artifact_list', { workspaceId: workspaceId ?? null, taskId: taskId ?? null });
  return JSON.parse(raw) as ArtifactManifest[];
}

export async function previewArtifact(path: string, pages?: number[]): Promise<string[]> {
  const raw = await invoke<string>('artifact_preview', { path, pages: pages ?? null });
  return JSON.parse(raw) as string[];
}
