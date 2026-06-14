import { describe, expect, it } from 'vitest';
import { readDocument, readManyDocuments, scanFolder, readRelevantFromFolder } from '../index';
import type { DocumentIO } from '../types';
import type { DocumentReference } from '../../references/types';

const files: Record<string, string> = {
  'C:\\docs\\szamla_001.txt': 'Szamlaszam: 001\nKibocsato: Larund\nVegosszeg: 12000 HUF',
  'C:\\docs\\szamla_002.txt': 'Szamlaszam: 002\nKibocsato: Larund\nVegosszeg: 8000 HUF',
  'C:\\docs\\data.csv': 'name,total\nA,10\nB,20',
};

const io: DocumentIO = {
  async readText(path) {
    const value = files[path];
    if (value == null) throw new Error(`not found ${path}`);
    return value;
  },
  async readSheet() {
    return { sheet: 'Sheet1', rows: [['A', 'B'], ['1', '2']], row_count: 2 };
  },
  async listDir(path) {
    if (path === 'C:\\docs') return ['szamla_001.txt', 'szamla_002.txt', 'data.csv'];
    return [];
  },
  async metadata(path) {
    const isDir = path === 'C:\\docs';
    return {
      isDir,
      isFile: !isDir,
      sizeBytes: files[path]?.length ?? 0,
      modifiedAt: '2026-01-01T00:00:00.000Z',
    };
  },
};

function ref(path: string): DocumentReference {
  return { id: path, kind: 'file', label: path.split('\\').pop() ?? path, path, source: 'user_reference' };
}

describe('document reader', () => {
  it('reads txt invoice content', async () => {
    const result = await readDocument(ref('C:\\docs\\szamla_001.txt'), { io });
    expect(result.ok).toBe(true);
    expect(result.contentText).toContain('Szamlaszam: 001');
  });

  it('reads two txt invoices', async () => {
    const results = await readManyDocuments([ref('C:\\docs\\szamla_001.txt'), ref('C:\\docs\\szamla_002.txt')], { io });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('reads csv as structured rows', async () => {
    const result = await readDocument(ref('C:\\docs\\data.csv'), { io });
    expect(result.metadata.rowCount).toBe(3);
    expect(result.structured).toEqual({ rows: [['name', 'total'], ['A', '10'], ['B', '20']] });
  });

  it('scans folder inventory', async () => {
    const folder: DocumentReference = { id: 'folder', kind: 'folder', label: 'docs', path: 'C:\\docs', source: 'user_reference' };
    const result = await scanFolder(folder, { io });
    expect(result.ok).toBe(true);
    expect(result.groups['.txt']).toBe(2);
  });

  it('reads relevant files from folder', async () => {
    const folder: DocumentReference = { id: 'folder', kind: 'folder', label: 'docs', path: 'C:\\docs', source: 'user_reference' };
    const result = await readRelevantFromFolder(folder, 'szamla', { io });
    expect(result.documents.length).toBeGreaterThanOrEqual(2);
  });
});
