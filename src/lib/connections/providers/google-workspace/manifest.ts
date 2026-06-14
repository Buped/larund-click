import type { ConnectionManifest } from '../../types';
import { scaffoldTool } from '../../scaffold';

// Scaffold: typed interface + disabled status until OAuth is wired up.
export const googleWorkspaceManifest: ConnectionManifest = {
  id: 'google-workspace',
  name: 'Google Workspace',
  description: 'Gmail, Drive, Sheets and Calendar (OAuth — coming soon).',
  auth: { type: 'oauth', scopes: ['gmail.readonly', 'drive.readonly', 'spreadsheets', 'calendar'] },
  scaffold: true,
  risk: 'external_write',
  tools: [
    scaffoldTool('gmail.search', 'Search Gmail messages.', 'external_read'),
    scaffoldTool('gmail.draft_reply', 'Draft a reply.', 'external_write'),
    scaffoldTool('gmail.send', 'Send an email.', 'external_send'),
    scaffoldTool('drive.search', 'Search Drive files.', 'external_read'),
    scaffoldTool('sheets.read', 'Read a Google Sheet.', 'external_read'),
    scaffoldTool('sheets.write', 'Write a Google Sheet.', 'external_write'),
    scaffoldTool('calendar.create_event', 'Create a calendar event.', 'external_write'),
  ],
};
