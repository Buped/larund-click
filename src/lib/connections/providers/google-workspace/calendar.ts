import type { ConnectionToolDefinition } from '../../types';

export const googleCalendarTools: ConnectionToolDefinition[] = [
  {
    name: 'google.calendar.create_event',
    description: 'Create a calendar event (scaffold).',
    risk: 'external_write',
    async run() {
      return { success: false, output: '', error: 'calendar_scaffold_not_enabled' };
    },
  },
];
