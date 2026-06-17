import { describe, expect, it } from 'vitest';
import { resourceToReference } from '../types';
import type { MentionResource } from '../types';
import { serializeReferences, deserializeReferences } from '../../references/serialize';

describe('structured mentions', () => {
  it('serializes mention chips separately from visible text', () => {
    const resource: MentionResource = {
      kind: 'skill',
      refId: 'built_in:task-verification',
      label: 'task-verification',
      detail: 'Built-in skill',
      available: true,
    };
    const ref = resourceToReference(resource);
    const roundtrip = deserializeReferences(serializeReferences([ref]));

    expect(roundtrip[0]).toMatchObject({
      kind: 'skill',
      refId: 'built_in:task-verification',
      label: 'task-verification',
      displayText: '@task-verification',
      status: 'available',
    });
  });
});
