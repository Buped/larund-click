import type { ConnectionManifest } from '../../types';
import { hubspotTools } from './tools';

export const hubspotManifest: ConnectionManifest = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM contacts, deals and follow-up tasks through HubSpot private app tokens.',
  auth: { type: 'api_key', envVars: ['HUBSPOT_PRIVATE_APP_TOKEN'] },
  risk: 'external_write',
  tools: hubspotTools,
};
