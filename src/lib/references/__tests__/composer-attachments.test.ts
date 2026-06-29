import { describe, expect, it, vi } from 'vitest';
import {
  dedupeDocumentReferences,
  mergeDocumentReferences,
  persistClipboardFile,
  referenceFromLocalPath,
  referencesFromPlainText,
} from '../composer-attachments';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => 'C:/Users/Test/AppData/Local/LarundClick'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

describe('composer attachment references', () => {
  it('extracts local paths and URLs from dropped text', () => {
    const refs = referencesFromPlainText([
      'C:\\Users\\Test\\Desktop\\report.xlsx',
      'file:///C:/Users/Test/Desktop/photo.png',
      'https://example.com/data',
      'not a path',
    ].join('\n'));

    expect(refs).toHaveLength(3);
    expect(refs[0]).toMatchObject({
      kind: 'file',
      path: 'C:\\Users\\Test\\Desktop\\report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(refs[1]).toMatchObject({ kind: 'file', path: 'C:/Users/Test/Desktop/photo.png', mimeType: 'image/png' });
    expect(refs[2]).toMatchObject({ kind: 'url', url: 'https://example.com/data' });
  });

  it('dedupes references by stable file/url target', () => {
    const refs = referencesFromPlainText('C:\\tmp\\a.png\nC:\\tmp\\a.png');
    expect(refs).toHaveLength(1);

    const merged = mergeDocumentReferences(refs, refs);
    expect(merged).toHaveLength(1);
  });

  it('detects folder references from metadata', async () => {
    const ref = await referenceFromLocalPath('C:\\Users\\Test\\Documents', {
      metadata: vi.fn(async () => ({ is_dir: true })),
    });

    expect(ref.kind).toBe('folder');
    expect(ref.mimeType).toBeUndefined();
  });

  it('persists anonymous clipboard images as local file references', async () => {
    const writes: Array<{ path: string; bytes: number[] }> = [];
    const file = new File([new Uint8Array([1, 2, 3])], 'clipboard.png', { type: 'image/png' });

    const ref = await persistClipboardFile(file, {
      scopeId: 'chat-1',
      now: () => 123,
      attachmentRoot: async () => 'C:/LarundData',
      writeBytes: async (path, bytes) => {
        writes.push({ path, bytes: Array.from(bytes) });
      },
    });

    expect(ref).toMatchObject({
      kind: 'file',
      label: 'clipboard.png',
      mimeType: 'image/png',
      path: 'C:/LarundData/attachments/chat-1/123-clipboard.png',
    });
    expect(writes).toEqual([{ path: ref.path!, bytes: [1, 2, 3] }]);
  });

  it('dedupes document references with different ids but same target', () => {
    const [first] = referencesFromPlainText('C:\\tmp\\same.pdf');
    const duplicate = { ...first, id: 'other-id' };

    expect(dedupeDocumentReferences([first, duplicate])).toEqual([first]);
  });
});
