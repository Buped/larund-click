import type { ConnectionManifest } from '../../types';
import { scaffoldTool } from '../../scaffold';

// Scaffold: typed interface + disabled status until auth is configured.
export const slackManifest: ConnectionManifest = {
  id: 'slack',
  name: 'Slack',
  description: 'Search and post Slack messages (coming soon).',
  auth: { type: 'api_key', envVars: ['SLACK_BOT_TOKEN'] },
  scaffold: true,
  risk: 'external_send',
  tools: [
    scaffoldTool('slack.search_messages', 'Search messages.', 'external_read'),
    scaffoldTool('slack.send_message', 'Send a message to a channel.', 'external_send'),
    scaffoldTool('slack.reply_thread', 'Reply in a thread.', 'external_send'),
  ],
};
