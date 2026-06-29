import { beforeEach, describe, expect, it } from 'vitest';
import { resourceToReference } from '../types';
import type { MentionResource } from '../types';
import { serializeReferences, deserializeReferences } from '../../references/serialize';
import { listMentionResources } from '../resources';
import { createConnectedAccount, __resetConnectedAccountsForTests } from '../../connections/connectedAccounts';

beforeEach(() => __resetConnectedAccountsForTests());

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

  it('uses user/project context when marking Google connection availability', async () => {
    await createConnectedAccount({
      ctx: { userId: 'alice', workspaceId: 'project-1' },
      providerId: 'google-workspace',
      accountLabel: 'Google',
      authType: 'oauth2',
      tokens: { access_token: 'google-token' },
    });

    const resources = await listMentionResources({ userId: 'alice', workspaceId: 'project-1', kinds: ['connection'] });
    const google = resources.find((resource) => resource.refId === 'google-workspace');

    expect(google).toMatchObject({ label: 'Google', available: true });
  });
});
