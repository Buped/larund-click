import { invoke } from '@tauri-apps/api/core';
import type { ArtifactManifest } from './types';

export async function copyArtifactTo(input: { artifactId?: string; fromPath?: string; targetDir: string }): Promise<string> {
  return invoke<string>('artifact_copy_to', {
    artifactId: input.artifactId ?? null,
    fromPath: input.fromPath ?? null,
    targetDir: input.targetDir,
  });
}

export async function openArtifact(path: string): Promise<string> {
  return invoke<string>('artifact_open', { path });
}

export function formatArtifactCard(manifest: ArtifactManifest): string {
  const outputs = manifest.outputFiles.map((file) => `- ${file.label} (${file.mimeType}, ${file.sizeBytes ?? 0} bytes)\n  ${file.path}`).join('\n');
  const checks = [
    manifest.verification.exists ? 'file exists' : 'file missing',
    manifest.verification.readable ? 'readable' : 'not readable',
    manifest.verification.pageCount ? `${manifest.verification.pageCount} page(s)` : undefined,
    manifest.verification.slideCount ? `${manifest.verification.slideCount} slide(s)` : undefined,
  ].filter(Boolean).join(', ');
  return `Created artifact: ${manifest.title}\n${outputs}\nVerified: ${checks}`;
}
