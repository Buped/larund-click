import { describe, expect, it } from 'vitest';
import type { ArtifactManifest } from '../types';
import { formatArtifactCount, formatBytes, manifestToChatArtifact } from '../ui';

const manifest: ArtifactManifest = {
  id: 'artifact-1',
  workspaceId: 'local',
  taskId: 'task-1',
  title: 'Test Szamla',
  kind: 'pdf',
  requestedBy: 'chat',
  createdAt: '2026-06-21T10:00:00Z',
  updatedAt: '2026-06-21T10:00:00Z',
  status: 'ready',
  sourceFiles: [],
  outputFiles: [{
    id: 'out-1',
    label: 'test-szamla.pdf',
    path: 'C:\\Users\\KomPhone\\AppData\\Roaming\\Larund\\artifacts\\local\\task-1\\output\\test-szamla.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    role: 'output',
  }],
  previewFiles: [{
    id: 'prev-1',
    label: 'thumbnail.png',
    path: 'C:\\Users\\KomPhone\\AppData\\Roaming\\Larund\\artifacts\\local\\task-1\\preview\\thumbnail.png',
    mimeType: 'image/png',
    role: 'preview',
  }],
  templateId: 'invoice-blue-corporate',
  verification: {
    exists: true,
    readable: true,
    pageCount: 1,
    containsExpectedText: ['Test Szamla'],
    warnings: [],
    errors: [],
  },
  metadata: {},
};

describe('artifact UI mapping', () => {
  it('maps a manifest to a chat attachment', () => {
    const attachment = manifestToChatArtifact(manifest);
    expect(attachment.artifactId).toBe('artifact-1');
    expect(attachment.displayName).toBe('Test Szamla');
    expect(attachment.fileName).toBe('test-szamla.pdf');
    expect(attachment.kind).toBe('pdf');
    expect(attachment.pageCount).toBe(1);
    expect(attachment.verification?.expectedTextPassed).toBe(true);
  });

  it('formats card metadata without requiring path as primary text', () => {
    const attachment = manifestToChatArtifact(manifest);
    expect(formatBytes(attachment.sizeBytes)).toBe('2 KB');
    expect(formatArtifactCount(attachment)).toBe('1 page');
    expect(`${attachment.displayName} ${attachment.kind.toUpperCase()} ${formatArtifactCount(attachment)}`).not.toContain('AppData');
  });
});
