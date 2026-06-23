// The Larund connection catalog. Honest by construction: only providers backed
// by real native tools in the connection registry are marked `working` here; the
// rest are `coming_soon` / `mcp_available` / `needs_setup` with real roadmap
// metadata so the UI can present a full directory without faking capability.

import type { CatalogProvider, ConnectionImplementation } from './types';
import { deriveFlags } from './types';
import { envSchemaForProvider } from '../env/schema';

const DOCS: Record<string, string> = {
  'google-workspace': 'https://developers.google.com/workspace',
  'google-drive': 'https://developers.google.com/workspace/drive/api/guides/about-sdk',
  'google-docs': 'https://developers.google.com/docs/api',
  'google-sheets': 'https://developers.google.com/sheets/api',
  gmail: 'https://developers.google.com/gmail/api',
  'google-calendar': 'https://developers.google.com/calendar/api',
  github: 'https://docs.github.com/en/rest',
  notion: 'https://developers.notion.com/docs/getting-started',
  slack: 'https://api.slack.com/web',
  discord: 'https://discord.com/developers/docs/intro',
  x: 'https://docs.x.com/x-api/introduction',
  'meta-ads': 'https://developers.facebook.com/',
  'instagram-business': 'https://developers.facebook.com/docs/instagram-platform',
  'facebook-pages': 'https://developers.facebook.com/docs/pages-api',
  'google-ads': 'https://developers.google.com/google-ads/api/docs/start',
  ga4: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
  'search-console': 'https://developers.google.com/webmaster-tools',
  airtable: 'https://airtable.com/developers/web/api/introduction',
  linear: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api',
  jira: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/',
  trello: 'https://developer.atlassian.com/cloud/trello/rest/',
  hubspot: 'https://developers.hubspot.com/docs/api/overview',
  wordpress: 'https://developer.wordpress.org/rest-api/',
  mailchimp: 'https://mailchimp.com/developer/marketing/docs/fundamentals/',
  brevo: 'https://developers.brevo.com/docs',
  shopify: 'https://shopify.dev/docs/api/admin-graphql',
  stripe: 'https://docs.stripe.com/api',
  supabase: 'https://supabase.com/docs/reference/api',
  vercel: 'https://vercel.com/docs/rest-api',
  netlify: 'https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/',
  cloudflare: 'https://developers.cloudflare.com/api/',
  sentry: 'https://docs.sentry.io/api/',
  langsmith: 'https://docs.smith.langchain.com/',
  figma: 'https://www.figma.com/developers/api',
  canva: 'https://www.canva.dev/docs/connect/',
  webflow: 'https://developers.webflow.com/data/reference/rest-introduction',
  framer: 'https://www.framer.com/developers/',
  higgsfield: 'https://higgsfield.ai/',
  resend: 'https://resend.com/docs/api-reference/introduction',
  sendgrid: 'https://www.twilio.com/docs/sendgrid/api-reference/how-to-use-the-sendgrid-v3-api',
  'microsoft-365': 'https://learn.microsoft.com/en-us/graph/overview',
};

function p(
  id: string,
  name: string,
  category: CatalogProvider['category'],
  description: string,
  status: CatalogProvider['status'],
  implementations: ConnectionImplementation[],
  extra: Partial<Pick<CatalogProvider, 'nativeToolCount' | 'setupInstructions' | 'docsUrl' | 'parentProviderId'>> = {},
): CatalogProvider {
  const flags = deriveFlags(implementations);
  const env = envSchemaForProvider(extra.parentProviderId ?? id);
  return {
    id, name, category, description, status, implementations,
    supportsNativeApi: flags.native,
    supportsMcp: flags.mcp,
    userEditableMcpUrl: flags.editableUrl,
    nativeToolCount: extra.nativeToolCount ?? 0,
    env: { required: env.required, optional: env.optional, advanced: env.advanced },
    parentProviderId: extra.parentProviderId,
    setupInstructions: extra.setupInstructions,
    docsUrl: extra.docsUrl ?? DOCS[id],
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
  p('google-workspace', 'Google', 'productivity', 'One Google connection — Drive, Gmail, Docs, Sheets, Calendar and more, via a single sign-in.', 'working',
    [nativeToken('google-workspace')], { nativeToolCount: 25, setupInstructions: 'Connect once with Google. Drive, Gmail, Docs, Sheets and Calendar all share this one sign-in; Ads/GA4/Search Console may need extra IDs/tokens.' }),

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
  p('x', 'X / Twitter', 'marketing', 'Search/read posts and users, connect multiple X accounts, then post/delete/schedule with approval and UC billing.', 'working',
    [nativeOauth('x'), remoteMcp()], {
      nativeToolCount: 29,
      setupInstructions: 'Register an X OAuth 2.0 app with callback http://localhost:14200/ and scopes tweet.read, tweet.write, users.read, offline.access. Set X_CLIENT_ID/X_CLIENT_SECRET for Connect, and X_APP_BEARER for app-only search when the user has not connected X.',
    }),
  p('meta-ads', 'Meta Ads', 'marketing', 'Ad accounts, campaigns and insights; create drafts. Publish only with approval.', 'coming_soon', [nativeOauth('meta')]),
  p('instagram-business', 'Instagram Business', 'marketing', 'Media, insights and publishing (publish needs approval).', 'coming_soon', [nativeOauth('meta')]),
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
  p('higgsfield', 'Higgsfield', 'creative', 'Generate images, video and audio. Connect with the Higgsfield CLI or a remote MCP server — no API key.', 'mcp_available',
    [remoteMcp('https://higgsfield.ai/mcp'), { kind: 'manual_setup', instructions: 'Higgsfield CLI: install, run `higgsfield auth login`, then Connect & inspect.' }],
    { nativeToolCount: 16, setupInstructions: 'Sign in with your Higgsfield account via the CLI (no API key), then approve the discovered tools.' }),

  // ── Email delivery ──────────────────────────────────────────────────────────
  p('resend', 'Resend', 'communication', 'Transactional email API.', 'coming_soon', [nativeApiKey('resend')]),
  p('sendgrid', 'SendGrid', 'communication', 'Transactional and marketing email.', 'coming_soon', [nativeApiKey('sendgrid')]),
];

export function getCatalogProvider(id: string): CatalogProvider | undefined {
  return CATALOG.find((c) => c.id === id);
}
