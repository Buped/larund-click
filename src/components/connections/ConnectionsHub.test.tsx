/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConnectionsHub } from './ConnectionsHub';
import { ConnectionSetupModal } from './ConnectionSetupModal';
import { defaultToolPolicy, getToolPolicy, setToolPolicy, toolPolicyKey } from './connection-ui-types';
import { SettingsScreen } from '../settings';
import { getResolvedProvider, listCatalogProviders } from '../../lib/connections/catalog';
import { __resetConnectedAccountsForTests } from '../../lib/connections/connectedAccounts';
import { setSecret } from '../../lib/connections/secrets';
import { beginOAuthConnect } from '../../lib/connections/oauth/connect';

vi.mock('../../lib/database', () => ({
  getSettings: vi.fn().mockResolvedValue(null),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  getApps: vi.fn().mockResolvedValue([]),
  saveApp: vi.fn().mockResolvedValue(undefined),
  deleteApp: vi.fn().mockResolvedValue(undefined),
  getMemoryEntries: vi.fn().mockResolvedValue([]),
  addMemoryEntry: vi.fn().mockResolvedValue(undefined),
  updateMemoryEntry: vi.fn().mockResolvedValue(undefined),
  deleteMemoryEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/mcp/connect-provider', () => ({
  mcpProviderState: vi.fn().mockResolvedValue({ state: 'not_configured', tools: [], message: '' }),
  connectMcpProvider: vi.fn(),
  disconnectMcpProvider: vi.fn(),
  setMcpProviderUrl: vi.fn(),
}));

vi.mock('../../lib/mcp/higgsfield/connect', () => ({
  higgsfieldConnectionState: vi.fn().mockResolvedValue({ state: 'not_configured', tools: [], message: '' }),
  higgsfieldDefaultMcpUrl: vi.fn().mockReturnValue('https://higgsfield.ai/mcp'),
  connectHiggsfieldCli: vi.fn(),
  connectHiggsfieldRemote: vi.fn(),
  setHiggsfieldMcpUrl: vi.fn(),
  disconnectHiggsfield: vi.fn(),
}));

vi.mock('../../lib/connections/oauth/connect', () => ({
  beginOAuthConnect: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  __resetConnectedAccountsForTests();
  setSecret('GOOGLE_CLIENT_ID', '');
  setSecret('GOOGLE_CLIENT_SECRET', '');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConnectionsHub UI integration', () => {
  it('Settings -> Connections renders the shared hub and not the legacy Google token panel', async () => {
    render(
      <SettingsScreen
        onClose={() => undefined}
        user={{ id: 'alice', email: 'alice@example.com', isAdmin: false }}
        credits={null}
        activeProject={{
          id: 'project-1',
          ownerUserId: 'alice',
          name: 'Project',
          description: '',
          kind: 'project',
          status: 'active',
          createdAt: '',
          updatedAt: '',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connections' }));

    expect(await screen.findByTestId('connections-hub')).toBeInTheDocument();
    expect(screen.queryByText('OAuth access token')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('ya29...')).not.toBeInTheDocument();
  });

  it('page and settings variants use the same catalog provider source', async () => {
    const expectedCount = listCatalogProviders({ userId: 'alice', workspaceId: 'project-1' }).length;

    const { unmount } = render(<ConnectionsHub userId="alice" projectId="project-1" isAdmin={false} variant="settings" compact showHeader={false} showSearch={false} showFilters={false} />);
    expect(screen.getByTestId('connections-hub').querySelectorAll('.conn-card')).toHaveLength(expectedCount);
    unmount();

    render(<ConnectionsHub userId="alice" projectId="project-1" isAdmin={false} variant="page" showHeader={false} showSearch={false} showFilters={false} />);
    expect(screen.getByTestId('connections-hub').querySelectorAll('.conn-card').length).toBeLessThanOrEqual(expectedCount);
    expect(screen.getByText('Google')).toBeInTheDocument();
  });

  it('OAuth connect button calls beginOAuthConnect and refreshes after success', async () => {
    setSecret('GOOGLE_CLIENT_ID', 'client');
    setSecret('GOOGLE_CLIENT_SECRET', 'secret');
    vi.mocked(beginOAuthConnect).mockResolvedValue({
      id: 'acct-1',
      userId: 'alice',
      providerId: 'google-workspace',
      accountLabel: 'alice@example.com',
      authType: 'oauth2',
      scopes: [],
      status: 'connected',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const provider = getResolvedProvider('google-workspace', { userId: 'alice' })!;
    const onSaved = vi.fn();

    render(
      <ConnectionSetupModal
        providerId="google-workspace"
        provider={provider}
        name="Google"
        userId="alice"
        isAdmin={false}
        projectId="project-1"
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }));

    await waitFor(() => expect(beginOAuthConnect).toHaveBeenCalledWith(
      'google-workspace',
      { userId: 'alice', workspaceId: 'project-1' },
      { accountLabel: undefined },
    ));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await screen.findByText('Connected alice@example.com.')).toBeInTheDocument();
  });

  it('uses user/workspace scoped tool policy keys and conservative risky defaults', () => {
    expect(defaultToolPolicy('external_send')).toBe('ask');
    expect(defaultToolPolicy('destructive')).toBe('ask');
    expect(defaultToolPolicy('process_exec')).toBe('ask');
    expect(defaultToolPolicy('read_only')).toBe('allow');

    setToolPolicy('alice', 'project-1', 'github', 'github.create_pr', 'block');
    expect(toolPolicyKey('alice', 'project-1', 'github', 'github.create_pr')).toBe('conn_tool_policy:alice:project-1:github:github.create_pr');
    expect(getToolPolicy('alice', 'project-1', 'github', 'github.create_pr', 'external_write')).toBe('block');
    expect(getToolPolicy('bob', 'project-1', 'github', 'github.create_pr', 'external_write')).toBe('allow');
  });
});
