import { describe, expect, it } from 'vitest';
import { cloudPreviewsFromAgentSteps, thinkingFromAgentSteps, type AgentDisplayStep } from '../agent-display';

describe('agent display helpers', () => {
  it('keeps verification and generic status out of visible thinking', () => {
    const thinking = thinkingFromAgentSteps([
      { id: '1', type: 'plan', output: 'Preparing the task target, primary route, response language, and verification before acting.' },
      { id: '2', type: 'verification', output: 'Verification failed: no read-back evidence.' },
      { id: '3', type: 'plan', output: 'I understand the goal as: create a Google Doc. Primary route: the configured connection/API.' },
    ]);

    expect(thinking?.content).toContain('create a Google Doc');
    expect(thinking?.content).not.toMatch(/Verification failed|Preparing the task target/i);
  });

  it('hydrates a Google Docs preview from connection call results', () => {
    const steps: AgentDisplayStep[] = [
      {
        id: 'a',
        type: 'tool_call',
        tool: 'connection.call',
        input: JSON.stringify({ action: 'connection.call', connection: 'google-workspace', tool: 'google.docs.create', args: { title: 'Client Brief' } }),
      },
      {
        id: 'a-result',
        type: 'tool_result',
        tool: 'connection.call',
        output: 'created',
        details: { documentId: 'doc-1', title: 'Client Brief', url: 'https://docs.google.com/document/d/doc-1/edit' },
      },
      {
        id: 'b',
        type: 'tool_call',
        tool: 'connection.call',
        input: JSON.stringify({ action: 'connection.call', connection: 'google-workspace', tool: 'google.docs.read', args: { documentId: 'doc-1' } }),
      },
      {
        id: 'b-result',
        type: 'tool_result',
        tool: 'connection.call',
        output: 'Executive summary\n\nThe document is ready.',
        details: { documentId: 'doc-1', text: 'Executive summary\n\nThe document is ready.' },
      },
    ];

    const previews = cloudPreviewsFromAgentSteps(steps);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      kind: 'google_doc',
      providerId: 'doc-1',
      title: 'Client Brief',
      verified: true,
    });
    expect(previews[0].textPreview).toContain('Executive summary');
  });

  it('hydrates a Google Sheets preview with rows and verification', () => {
    const steps: AgentDisplayStep[] = [
      {
        id: 'a',
        type: 'tool_call',
        tool: 'connection.call',
        input: JSON.stringify({ action: 'connection.call', connection: 'google-workspace', tool: 'google.sheets.write_values', args: { spreadsheetId: 'sheet-1' } }),
      },
      {
        id: 'a-result',
        type: 'tool_result',
        tool: 'connection.call',
        output: 'Wrote 2 rows. Read-back: 2 rows verified.',
        details: { spreadsheetId: 'sheet-1', verified: true, readBack: [['Name', 'Score'], ['Ada', '98']], readRows: 2 },
      },
    ];

    const previews = cloudPreviewsFromAgentSteps(steps);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      kind: 'google_sheet',
      providerId: 'sheet-1',
      verified: true,
      rowCount: 2,
    });
    expect(previews[0].rowsPreview?.[1]).toEqual(['Ada', '98']);
  });
});
