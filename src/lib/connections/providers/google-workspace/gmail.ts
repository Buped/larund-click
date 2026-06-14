import type { ConnectionToolDefinition } from '../../types';

export const googleGmailTools: ConnectionToolDefinition[] = [
  {
    name: 'google.gmail.search',
    description: 'Search Gmail messages (scaffold).',
    risk: 'external_read',
    async run() {
      return { success: false, output: '', error: 'gmail_scaffold_not_enabled' };
    },
  },
];
