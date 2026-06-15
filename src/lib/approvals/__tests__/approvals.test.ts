import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { listNotifications } from '../../notifications/store';
import { createApprovalRequest, listApprovalRequests, resolveApprovalRequest } from '../store';

beforeEach(() => resetRecordBackendForTests());

describe('approval inbox', () => {
  it('persists approval lifecycle and emits notification', async () => {
    const req = await createApprovalRequest({
      userId: 'u1',
      actionName: 'connection.external_send',
      risk: 'external_send',
      reason: 'send email',
      argsSummary: 'to=a@example.com',
    });
    expect(await listApprovalRequests({ userId: 'u1', status: 'pending' })).toHaveLength(1);
    expect(await listNotifications({ userId: 'u1', unreadOnly: true })).toHaveLength(1);
    await resolveApprovalRequest(req.id, 'denied');
    expect(await listApprovalRequests({ userId: 'u1', status: 'denied' })).toHaveLength(1);
  });
});
