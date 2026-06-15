import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { addEvidence, createTaskRun, listEvidence } from '../../tasks/store';
import { MemoryAuditLogger, sanitizeArgs, summarizeOutput } from '../audit';

beforeEach(() => resetRecordBackendForTests());

describe('secret redaction', () => {
  it('redacts nested secret args and outputs', () => {
    const token = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const args = sanitizeArgs({ nested: { authorization: `Bearer ${token}`, normal: 'ok' } });
    expect(args).toContain('redacted');
    expect(args).not.toContain(token);
    expect(summarizeOutput(`token=${token}`)).not.toContain(token);
  });

  it('redacts audit entries and evidence content', async () => {
    const token = 'ya29.abcdefghijklmnopqrstuvwxyz1234567890';
    const audit = new MemoryAuditLogger();
    audit.record({ id: 'a1', timestamp: 1, sessionId: 's1', action: 'connection.call', argsSummary: JSON.stringify({ token }), risk: 'credential_access', category: 'connections', outputSummary: token });
    expect(JSON.stringify(audit.list())).not.toContain(token);
    const task = await createTaskRun({ userId: 'u1', sessionId: 's1', title: 't', originalPrompt: 't', modelId: 'core', autonomyMode: 'semi' });
    await addEvidence({ taskRunId: task.id, userId: 'u1', kind: 'tool_result', title: 'secret', content: `secret=${token}` });
    expect((await listEvidence(task.id))[0].content).not.toContain(token);
  });
});
