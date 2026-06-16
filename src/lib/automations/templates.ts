// Starter templates for the empty state + New Automation wizard. A template
// prefills the wizard (goal, suggested trigger, suggested connections,
// verification). It never silently requires unavailable connections — the wizard
// runs dependency checks and surfaces blockers.

import type { AutomationTrigger, VerificationCheck } from './types';

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  /** A connection id used for the card's brand icon. */
  iconProviderId: string;
  prompt: string;
  suggestedTrigger: AutomationTrigger;
  suggestedConnectionIds: string[];
  verification: VerificationCheck[];
}

function v(title: string, kind: VerificationCheck['kind']): VerificationCheck {
  return { id: `v-${kind}`, title, kind, required: true };
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'daily-exec-brief', name: 'Daily executive brief', iconProviderId: 'gmail',
    description: 'Every morning, summarize unread Gmail and calendar events into a short brief.',
    prompt: 'Every morning, use @Gmail and @Google Calendar to summarize my unread email and today\'s events into a concise executive brief, then save it as a local markdown file.',
    suggestedTrigger: { kind: 'schedule', cron: '0 8 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    suggestedConnectionIds: ['gmail', 'google-calendar'],
    verification: [v('Brief file exists', 'file_exists'), v('Brief was read back', 'file_read_back')],
  },
  {
    id: 'weekly-marketing-report', name: 'Weekly marketing report', iconProviderId: 'google-ads',
    description: 'Every Friday, build a marketing report from Google Ads, GA4 and Search Console.',
    prompt: 'Every Friday, use @Google Ads, @GA4 and @Search Console to create a weekly marketing performance report and write it to a Google Doc.',
    suggestedTrigger: { kind: 'schedule', cron: '0 9 * * 5', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    suggestedConnectionIds: ['google-ads', 'ga4', 'search-console'],
    verification: [v('Doc exists and can be read', 'doc_read_back')],
  },
  {
    id: 'invoice-folder', name: 'Invoice folder processor', iconProviderId: 'google-sheets',
    description: 'When a new invoice PDF appears in a folder, extract its data and append it to a Google Sheet.',
    prompt: 'When a new invoice PDF appears in the watched folder, extract the invoice fields and append a row to @Google Sheets.',
    suggestedTrigger: { kind: 'folder_watch', path: '', pattern: '*.pdf' },
    suggestedConnectionIds: ['google-sheets'],
    verification: [v('Sheet values were read back', 'sheet_values_match')],
  },
  {
    id: 'github-triage', name: 'GitHub issue triage', iconProviderId: 'github',
    description: 'Every day, triage new GitHub issues and summarize what needs attention.',
    prompt: 'Each morning, use @GitHub to list new/open issues, group them by priority, and write a triage summary to a local file.',
    suggestedTrigger: { kind: 'schedule', cron: '0 9 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    suggestedConnectionIds: ['github'],
    verification: [v('Triage summary file exists', 'file_exists'), v('Summary was read back', 'file_read_back')],
  },
  {
    id: 'meta-spend', name: 'Meta Ads spend monitor', iconProviderId: 'meta-ads',
    description: 'Every day, check Meta Ads spend and send a short performance report.',
    prompt: 'Every day, use @Meta Ads to check campaign spend and performance, then write a short report. Ask before sending it anywhere.',
    suggestedTrigger: { kind: 'schedule', cron: '0 18 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    suggestedConnectionIds: ['meta-ads'],
    verification: [v('Report file exists', 'file_exists')],
  },
  {
    id: 'social-ideas', name: 'Social post idea generator', iconProviderId: 'twitter',
    description: 'Every Monday, research competitors\' X posts and create content ideas.',
    prompt: 'Every Monday, use @X (Twitter) to research competitor posts in my niche and produce a list of content ideas saved to a local file.',
    suggestedTrigger: { kind: 'schedule', cron: '0 9 * * 1', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    suggestedConnectionIds: ['twitter'],
    verification: [v('Ideas file exists', 'file_exists')],
  },
  {
    id: 'lead-research', name: 'New lead research', iconProviderId: 'hubspot',
    description: 'Research new leads and enrich them in your CRM.',
    prompt: 'For new leads in @HubSpot, research the company and contact, then write an enrichment note. Ask before updating any records.',
    suggestedTrigger: { kind: 'manual' },
    suggestedConnectionIds: ['hubspot'],
    verification: [v('Connection call succeeded', 'connection_read_back')],
  },
  {
    id: 'sheet-cleanup', name: 'Google Sheet cleanup', iconProviderId: 'google-sheets',
    description: 'Normalize and de-duplicate a Google Sheet, with read-back verification.',
    prompt: 'Clean up @Google Sheets: normalize formatting and flag duplicates in a summary, then read back the affected ranges to verify.',
    suggestedTrigger: { kind: 'manual' },
    suggestedConnectionIds: ['google-sheets'],
    verification: [v('Sheet values were read back', 'sheet_values_match')],
  },
  {
    id: 'competitor-monitor', name: 'Competitor monitoring', iconProviderId: 'github',
    description: 'Monitor competitors across sources and summarize changes weekly.',
    prompt: 'Weekly, research competitor updates from the sources I reference and summarize notable changes to a local report.',
    suggestedTrigger: { kind: 'schedule', cron: '0 9 * * 1', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    suggestedConnectionIds: [],
    verification: [v('Report file exists', 'file_exists'), v('Report was read back', 'file_read_back')],
  },
  {
    id: 'meeting-prep', name: 'Meeting prep', iconProviderId: 'google-calendar',
    description: 'Before meetings, gather context and prepare a brief.',
    prompt: 'For today\'s @Google Calendar meetings, gather relevant context and prepare a short prep brief saved to a local file.',
    suggestedTrigger: { kind: 'schedule', cron: '0 7 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    suggestedConnectionIds: ['google-calendar'],
    verification: [v('Prep brief file exists', 'file_exists')],
  },
];
