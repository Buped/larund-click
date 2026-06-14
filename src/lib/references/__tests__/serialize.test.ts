import { describe, expect, it } from 'vitest';
import { appendReferenceSummary, deserializeReferences, serializeReferences } from '../serialize';
import type { DocumentReference } from '../types';

const ref: DocumentReference = {
  id: 'file-1',
  kind: 'file',
  label: 'project-plan.md',
  path: 'C:\\docs\\project-plan.md',
  source: 'user_reference',
};

describe('reference serialization', () => {
  it('roundtrips document references', () => {
    expect(deserializeReferences(serializeReferences([ref]))).toEqual([ref]);
  });

  it('renders references into user-visible context', () => {
    expect(appendReferenceSummary('Summarize this', [ref])).toContain('project-plan.md');
  });
});
