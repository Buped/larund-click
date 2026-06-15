import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { PromptApprovalService } from '../../tools/approvals';
import { MemoryAuditLogger } from '../../tools/audit';
import { callCustomApiTool } from '../call';
import { classifyCustomApiTool } from '../risk';
import { createCustomApiConnection, createCustomApiTool } from '../store';

beforeEach(() => resetRecordBackendForTests());

describe('custom api builder', () => {
  it('classifies GET/POST/DELETE and send-like tools', () => {
    expect(classifyCustomApiTool({ method: 'GET', name: 'list', pathTemplate: '/items', description: 'Read items' })).toBe('external_read');
    expect(classifyCustomApiTool({ method: 'POST', name: 'create', pathTemplate: '/items', description: 'Create item' })).toBe('external_write');
    expect(classifyCustomApiTool({ method: 'DELETE', name: 'delete', pathTemplate: '/items/{id}', description: 'Delete item' })).toBe('destructive');
    expect(classifyCustomApiTool({ method: 'POST', name: 'send_message', pathTemplate: '/messages', description: 'Send message' })).toBe('external_send');
  });

  it('allows read-only calls and approval-gates DELETE', async () => {
    const conn = await createCustomApiConnection({ userId: 'u1', name: 'API', baseUrl: 'https://api.example.com' });
    const get = await createCustomApiTool({ connectionId: conn.id, name: 'get_items', description: 'Read items', method: 'GET', pathTemplate: '/items' });
    const del = await createCustomApiTool({ connectionId: conn.id, name: 'delete_item', description: 'Delete item', method: 'DELETE', pathTemplate: '/items/{id}' });
    const audit = new MemoryAuditLogger();
    expect((await callCustomApiTool({ userId: 'u1', connectionId: conn.id, toolId: get.id, input: {}, audit })).success).toBe(true);
    expect((await callCustomApiTool({ userId: 'u1', connectionId: conn.id, toolId: del.id, input: { id: 1 }, approvals: new PromptApprovalService(undefined, 'deny') })).error).toBe('approval_denied');
    expect(audit.list()[0].argsSummary).not.toContain('secret');
  });
});
