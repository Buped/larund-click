import { describe, expect, it } from 'vitest';
import { createTaskState } from '../../agent-state/task-state';
import { preflight } from '../preflight';
import { shouldBlockBrowserBeforeConnection } from '../loop';
import type { ConnectionRegistry } from '../../tools/types';

const configuredConnections: ConnectionRegistry = {
  isConfigured: (id) => id === 'google-workspace',
  call: async () => ({ success: true, output: '' }),
};

const missingConnections: ConnectionRegistry = {
  isConfigured: () => false,
  call: async () => ({ success: false, output: '', error: 'missing_auth' }),
};

describe('Google Workspace connection-first guard', () => {
  it('blocks browser.open to sheets.new before a configured Google connection is tried', () => {
    const taskState = createTaskState('Create a Google Sheet with 5 rows', preflight('Create a Google Sheet with 5 rows'));
    const block = shouldBlockBrowserBeforeConnection({
      action: { action: 'browser.open', url: 'https://sheets.new' },
      taskState,
      recentActions: [],
      connections: configuredConnections,
    });

    expect(block).toMatch(/connection_first_required/);
  });

  it('allows browser fallback when Google Workspace is not configured', () => {
    const taskState = createTaskState('Create a Google Sheet with 5 rows', preflight('Create a Google Sheet with 5 rows'));
    const block = shouldBlockBrowserBeforeConnection({
      action: { action: 'browser.open', url: 'https://sheets.new' },
      taskState,
      recentActions: [],
      connections: missingConnections,
    });

    expect(block).toBeNull();
  });

  it('allows browser fallback after an auth/unavailable connection failure', () => {
    const taskState = createTaskState('Create a Google Sheet with 5 rows', preflight('Create a Google Sheet with 5 rows'));
    const block = shouldBlockBrowserBeforeConnection({
      action: { action: 'browser.open', url: 'https://sheets.new' },
      taskState,
      recentActions: [
        {
          action: 'connection.call',
          argsSummary: '{"connection":"google-workspace","tool":"google.sheets.create"}',
          success: false,
          error: 'missing_auth',
        },
      ],
      connections: configuredConnections,
    });

    expect(block).toBeNull();
  });
});
