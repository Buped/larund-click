import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractPlaceholders, fillTemplate, listTemplates, saveTemplate, deleteTemplate,
} from '../templates';

// Node env has no localStorage — provide a minimal in-memory stub.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe('email templates', () => {
  it('extracts unique placeholders in first-seen order', () => {
    expect(extractPlaceholders('Szia {{név}}', 'Kedves {{ név }}, {{cég}}!')).toEqual(['név', 'cég']);
  });

  it('fills provided placeholders and leaves the rest intact', () => {
    const { subject, body } = fillTemplate(
      { subject: 'Ajánlat — {{cég}}', body: 'Szia {{név}}, {{ár}}' },
      { cég: 'Acme', név: 'Anna' },
    );
    expect(subject).toBe('Ajánlat — Acme');
    expect(body).toBe('Szia Anna, {{ár}}'); // {{ár}} unfilled stays as-is
  });

  it('lists built-ins before user templates', () => {
    const list = listTemplates('u1');
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0].builtin).toBe(true);
  });

  it('saves, lists and deletes a user template', () => {
    const saved = saveTemplate('u1', { name: 'Teszt', subject: 'S {{x}}', body: 'B' });
    expect(saved.placeholders).toEqual(['x']);
    const afterSave = listTemplates('u1');
    expect(afterSave.some((t) => t.id === saved.id && !t.builtin)).toBe(true);
    const afterDelete = deleteTemplate('u1', saved.id);
    expect(afterDelete.some((t) => t.id === saved.id)).toBe(false);
  });

  it('isolates templates per user', () => {
    saveTemplate('u1', { name: 'Csak u1', subject: 's', body: 'b' });
    expect(listTemplates('u2').some((t) => t.name === 'Csak u1')).toBe(false);
  });
});
