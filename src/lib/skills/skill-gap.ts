import type { DocumentReference } from '../references/types';
import type { SkillRouterInput, SkillRouterResult } from './router';

export type SkillGapKind = 'none' | 'one_off' | 'learnable';

export interface SkillGapDecision {
  kind: SkillGapKind;
  confidence: number;
  reason: string;
  target?: {
    domain?: string;
    appName?: string;
    label: string;
  };
  task: string;
}

const WORKFLOW_RE = /\b(create|update|fill|submit|sync|copy|import|export|record|register|invoice|lead|crm|report|dashboard|workflow|every|daily|weekly|monthly|ism[eé]tl|rendszeres|hozz l[eé]tre|r[oö]gz[ií]t|t[oö]ltsd ki|friss[ií]ts)\b/i;
const ONE_OFF_RE = /\b(once|one[- ]off|just this|quick question|explain|brainstorm|summarize this only|egyszeri|csak most|magy[aá]r[aá]zd|otletelj)\b/i;

function domainFromText(text: string): string | undefined {
  const url = text.match(/https?:\/\/[^\s"')]+/)?.[0];
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return undefined;
    }
  }
  const domain = text.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i)?.[0];
  return domain?.replace(/^www\./, '').toLowerCase();
}

function appNameFromText(text: string): string | undefined {
  const known = text.match(/\b(HubSpot|Salesforce|QuickBooks|Xero|Notion|Airtable|Asana|Trello|WordPress|Shopify|Stripe|GitHub|Gmail|Google Sheets|Google Docs)\b/i)?.[0];
  if (known) return known;
  const quoted = text.match(/["“']([A-Z][A-Za-z0-9 ._-]{2,40})["”']/)?.[1];
  return quoted;
}

function targetFromReferences(refs: DocumentReference[] = []): { domain?: string; appName?: string; label: string } | undefined {
  for (const ref of refs) {
    const text = `${ref.url ?? ''} ${ref.path ?? ''} ${ref.label ?? ''}`;
    const domain = domainFromText(text);
    if (domain) return { domain, label: domain };
  }
  return undefined;
}

export function detectSkillGap(result: SkillRouterResult, input: SkillRouterInput): SkillGapDecision {
  const task = `${input.task}\n${input.userMessage}`.trim();
  const confidence = result.confidence ?? 0;
  const target = targetFromReferences(input.references)
    ?? (() => {
      const domain = domainFromText(task);
      if (domain) return { domain, label: domain };
      const appName = appNameFromText(task);
      return appName ? { appName, label: appName } : undefined;
    })();

  if (!target) {
    return { kind: 'none', confidence, reason: 'No identifiable app, site, or domain target.', task };
  }
  if (ONE_OFF_RE.test(task) || !WORKFLOW_RE.test(task)) {
    return { kind: 'one_off', confidence, reason: 'The target is identifiable, but the request looks one-off rather than reusable.', target, task };
  }
  if (result.primarySkill && confidence >= 0.45 && !result.shouldAskUser) {
    return { kind: 'none', confidence, reason: 'An existing skill is confident enough for this task.', target, task };
  }
  return {
    kind: 'learnable',
    confidence,
    reason: result.primarySkill ? `Low skill confidence (${Math.round(confidence * 100)}%).` : 'No matching skill was selected.',
    target,
    task,
  };
}
