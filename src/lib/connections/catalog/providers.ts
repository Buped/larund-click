// The Larund connection catalog. Honest by construction: only providers backed
// by real native tools in the connection registry are marked `working` here; the
// rest are `coming_soon` / `mcp_available` / `needs_setup` with real roadmap
// metadata so the UI can present a full directory without faking capability.

import type { CatalogProvider, ConnectionImplementation } from './types';
import { deriveFlags } from './types';

function p(
  id: string,
  name: string,
  category: CatalogProvider['category'],
  description: string,
  status: CatalogProvider['status'],
  implementations: ConnectionImplementation[],
  extra: Partial<Pick<CatalogProvider, 'nativeToolCount' | 'setupInstructions' | 'docsUrl'>> = {},
): CatalogProvider {
  const flags = deriveFlags(implementations);
  return {
    id, name, category, description, status, implementations,
    supportsNativeApi: flags.native,
    supportsMcp: flags.mcp,
    userEditableMcpUrl: flags.editableUrl,
    nativeToolCount: extra.nativeToolCount ?? 0,
    setupInstructions: extra.setupInstructions,
    docsUrl: extra.docsUrl,
  };
}

const nativeOauth = (mod: string): ConnectionImplementation => ({ kind: 'native_api', authType: 'oauth2', providerModule: mod });
const nativePat = (mod: string): ConnectionImplementation => ({ kind: 'native_api', authType: 'personal_access_token', providerModule: mod });
const nativeApiKey = (mod: string): ConnectionImplementation => ({ kind: 'native_api', authType: 'api_key', providerModule: mod });
const nativeToken = (mod: string): ConnectionImplementation => ({ kind: 'native_api', authType: 'access_token', providerModule: mod });
const remoteMcp = (defaultServerUrl?: string): ConnectionImplementation => ({ kind: 'remote_mcp', defaultServerUrl, userEditableUrl: true });

export const CATALOG: CatalogProvider[] = [
  // ── Working native integrations (real tools in the registry) ────────────────
  p('github', 'GitHub', 'development', 'Read repos, manage issues, create branches and open PRs.', 'working',
    [nativePat('github'), remoteMcp()], { nativeToolCount: 7, setupInstructions: 'Add a GitHub personal access token (repo scope).', docsUrl: 'https://github.com/settings/tokens' }),
  p('notion', 'Notion', 'productivity', 'Search, read and write Notion pages and databases.', 'working',
    [nativePat('notion'), remoteMcp()], { nativeToolCount: 7, setupInstructions: 'Create an internal integration token and share pages with it.', docsUrl: 'https://www.notion.so/my-integrations' }),
  p('google-workspace', 'Google Workspace', 'productivity', 'Drive, Docs, Sheets, Gmail and Calendar via Google APIs.', 'working',
    [nativeToken('google-workspace')], { nativeToolCount: 20, setupInstructions: 'Connect with a Google OAuth access token (Drive/Docs/Sheets/Gmail/Calendar scopes).' }),

  // Google sub-apps — surfaced as their own cards but powered by Google Workspace.
  p('google-drive', 'Google Drive', 'productivity', 'Search, read and create files and folders in Drive.', 'working', [nativeToken('google-workspace')], { nativeToolCount: 5 }),
  p('google-docs', 'Google Docs', 'productivity', 'Create, read and edit Google Docs.', 'working', [nativeToken('google-workspace')], { nativeToolCount: 5 }),
  p('google-sheets', 'Google Sheets', 'data', 'Create sheets, read and write values, append rows.', 'working', [nativeToken('google-workspace')], { nativeToolCount: 6 }),
  p('gmail', 'Gmail', 'communication', 'Search and read threads, draft and send email (send needs approval).', 'partial', [nativeToken('google-workspace')], { nativeToolCount: 4 }),
  p('google-calendar', 'Google Calendar', 'productivity', 'Search events and create events (create needs approval).', 'partial', [nativeToken('google-workspace')], { nativeToolCount: 2 }),

  // ── Communication ───────────────────────────────────────────────────────────
  p('slack', 'Slack', 'communication', 'Search messages, read channels, post messages (post needs approval).', 'coming_soon',
    [nativeApiKey('slack'), remoteMcp()], { setupInstructions: 'Add a Slack bot token (xoxb-…).' }),
  p('discord', 'Discord', 'communication', 'List channels, read and send messages (send needs approval).', 'coming_soon', [nativeApiKey('discord'), remoteMcp()]),
  p('microsoft-365', 'Microsoft 365', 'productivity', 'Word, Excel, Outlook and OneDrive.', 'coming_soon', [nativeOauth('microsoft'), remoteMcp()]),

  // ── Productivity / project management ───────────────────────────────────────
  p('airtable', 'Airtable', 'data', 'List bases/tables, read records, create and update records.', 'coming_soon', [nativeApiKey('airtable'), remoteMcp()]),
  p('trello', 'Trello', 'productivity', 'Boards, lists and cards.', 'coming_soon', [nativeApiKey('trello'), remoteMcp()]),
  p('linear', 'Linear', 'productivity', 'Track issues, projects and cycles.', 'mcp_available', [remoteMcp(), nativeApiKey('linear')]),
  p('jira', 'Jira / Atlassian', 'productivity', 'Issues, projects and workflows.', 'coming_soon', [nativeOauth('atlassian'), remoteMcp()]),

  // ── Marketing / CRM ─────────────────────────────────────────────────────────
  p('hubspot', 'HubSpot', 'marketing', 'Search contacts/companies, create contacts, update deals, create tasks.', 'coming_soon', [nativeOauth('hubspot'), remoteMcp()]),
  p('wordpress', 'WordPress', 'marketing', 'List posts, create drafts, update and publish (publish needs approval).', 'coming_soon', [nativeApiKey('wordpress'), remoteMcp()]),
  p('mailchimp', 'Mailchimp', 'marketing', 'Audiences, campaigns and email automation.', 'coming_soon', [nativeApiKey('mailchimp')]),
  p('brevo', 'Brevo', 'marketing', 'Email/SMS campaigns and transactional sends.', 'coming_soon', [nativeApiKey('brevo')]),

  // ── Commerce / finance ──────────────────────────────────────────────────────
  p('shopify', 'Shopify', 'commerce', 'List products, get orders, update products, create discounts (write needs approval).', 'coming_soon', [nativeApiKey('shopify'), remoteMcp()]),
  p('stripe', 'Stripe', 'finance', 'List customers/invoices, create invoice drafts. No payments without explicit approval.', 'coming_soon', [nativeApiKey('stripe'), remoteMcp()]),

  // ── Social / ads ────────────────────────────────────────────────────────────
  p('twitter', 'X (Twitter)', 'marketing', 'Search posts, get users/posts, create posts (post needs approval).', 'coming_soon', [nativeOauth('x'), remoteMcp()]),
  p('meta-ads', 'Meta Ads', 'marketing', 'Ad accounts, campaigns and insights; create drafts. Publish only with approval.', 'coming_soon', [nativeOauth('meta')]),
  p('instagram', 'Instagram Business', 'marketing', 'Media, insights and publishing (publish needs approval).', 'coming_soon', [nativeOauth('meta')]),
  p('facebook-pages', 'Facebook Pages', 'marketing', 'Page posts and insights.', 'coming_soon', [nativeOauth('meta')]),
  p('google-ads', 'Google Ads', 'marketing', 'Campaigns, ad groups and performance.', 'coming_soon', [nativeOauth('google')]),

  // ── Analytics ───────────────────────────────────────────────────────────────
  p('ga4', 'Google Analytics 4', 'analytics', 'Reports, dimensions and metrics.', 'coming_soon', [nativeOauth('google')]),
  p('search-console', 'Google Search Console', 'analytics', 'Search performance, indexing and sitemaps.', 'coming_soon', [nativeOauth('google')]),
  p('sentry', 'Sentry', 'development', 'Issues, releases and error tracking.', 'coming_soon', [nativeApiKey('sentry'), remoteMcp()]),
  p('langsmith', 'LangSmith', 'development', 'LLM traces and evaluations.', 'coming_soon', [nativeApiKey('langsmith')]),

  // ── Dev infra / hosting ─────────────────────────────────────────────────────
  p('supabase', 'Supabase', 'development', 'Query databases, manage projects and edge functions.', 'mcp_available', [remoteMcp('https://mcp.supabase.com/mcp'), nativeApiKey('supabase')]),
  p('vercel', 'Vercel', 'development', 'Deploy and inspect frontend projects.', 'mcp_available', [remoteMcp(), nativeApiKey('vercel')]),
  p('netlify', 'Netlify', 'development', 'Sites, deploys and build hooks.', 'coming_soon', [nativeApiKey('netlify')]),
  p('cloudflare', 'Cloudflare', 'development', 'DNS, Workers and zone management.', 'coming_soon', [nativeApiKey('cloudflare'), remoteMcp()]),

  // ── Creative / design ───────────────────────────────────────────────────────
  p('figma', 'Figma', 'creative', 'Read designs and sync code with design.', 'mcp_available', [remoteMcp()]),
  p('canva', 'Canva', 'creative', 'Generate and edit visual designs.', 'mcp_available', [remoteMcp()]),
  p('webflow', 'Webflow', 'creative', 'CMS items, collections and site publishing.', 'coming_soon', [nativeApiKey('webflow'), remoteMcp()]),
  p('framer', 'Framer', 'creative', 'Sites and CMS.', 'coming_soon', [nativeApiKey('framer')]),
  p('higgsfield', 'Higgsfield', 'creative', 'Generate images, video and audio via MCP.', 'mcp_available', [remoteMcp()]),

  // ── Email delivery ──────────────────────────────────────────────────────────
  p('resend', 'Resend', 'communication', 'Transactional email API.', 'coming_soon', [nativeApiKey('resend')]),
  p('sendgrid', 'SendGrid', 'communication', 'Transactional and marketing email.', 'coming_soon', [nativeApiKey('sendgrid')]),
];

export function getCatalogProvider(id: string): CatalogProvider | undefined {
  return CATALOG.find((c) => c.id === id);
}
