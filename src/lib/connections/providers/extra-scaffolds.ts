import type { ConnectionManifest } from '../types';
import { scaffoldTool } from '../scaffold';

// Manifest-only scaffolds: registered (so they appear in the UI as disabled),
// but not runnable until implemented + configured.
export const hubspotManifest: ConnectionManifest = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM contacts, deals and companies (coming soon).',
  auth: { type: 'api_key', envVars: ['HUBSPOT_TOKEN'] },
  scaffold: true,
  risk: 'external_write',
  tools: [
    scaffoldTool('hubspot.search_contacts', 'Search contacts.', 'external_read'),
    scaffoldTool('hubspot.create_contact', 'Create a contact.', 'external_write'),
  ],
};

export const airtableManifest: ConnectionManifest = {
  id: 'airtable',
  name: 'Airtable',
  description: 'Bases, tables and records (coming soon).',
  auth: { type: 'api_key', envVars: ['AIRTABLE_TOKEN'] },
  scaffold: true,
  risk: 'external_write',
  tools: [
    scaffoldTool('airtable.list_records', 'List records.', 'external_read'),
    scaffoldTool('airtable.create_record', 'Create a record.', 'external_write'),
  ],
};

export const wordpressManifest: ConnectionManifest = {
  id: 'wordpress',
  name: 'WordPress',
  description: 'Posts and pages via REST API (coming soon).',
  auth: { type: 'api_key', envVars: ['WORDPRESS_URL', 'WORDPRESS_APP_PASSWORD'] },
  scaffold: true,
  risk: 'external_write',
  tools: [
    scaffoldTool('wordpress.list_posts', 'List posts.', 'external_read'),
    scaffoldTool('wordpress.create_post', 'Create a draft post.', 'external_write'),
  ],
};
