import type { DocumentReference } from '../references/types';
import type { ToolRisk } from '../control-system/types';
import type { RichSkillManifest } from './manifest';
import type { MissingRequirement } from './types';

export interface TaskHistory {
  task: string;
  selectedSkillIds?: string[];
  failedSkillIds?: string[];
  outcome?: 'success' | 'failed' | 'blocked';
}

export interface SkillRouterInput {
  task: string;
  userMessage: string;
  activeWorkspaceId?: string;
  references?: DocumentReference[];
  availableTools: string[];
  availableConnections: string[];
  enabledSkillIds: string[];
  recentTaskHistory?: TaskHistory[];
  currentSurface?: 'local_files' | 'browser' | 'google_workspace' | 'github' | 'notion' | 'unknown';
}

export interface SkillRoute {
  skillId: string;
  name: string;
  confidence: number;
  score: number;
  reason: string;
  missingRequirements: MissingRequirement[];
  manifest: RichSkillManifest;
}

export interface SkillRouterResult {
  selectedSkills: SkillRoute[];
  primarySkill?: SkillRoute;
  confidence: number;
  reason: string;
  missingRequirements: MissingRequirement[];
  shouldAskUser: boolean;
}

const RISK_WEIGHT: Record<ToolRisk, number> = {
  read_only: 0,
  local_write: 0,
  external_read: -0.05,
  external_write: -0.1,
  external_send: -0.2,
  destructive: -0.45,
  credential_access: -0.25,
  process_exec: -0.15,
};

const SYNONYMS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /sz[aá]mla|k[oö]nyvel|bizonylat|receipt|invoice/i, terms: ['document-accounting', 'invoice', 'receipt', 'accounting'] },
  { pattern: /google\s*(t[aá]bl[aá]zat|sheet|sheets)|online\s*(t[aá]bl[aá]zat|spreadsheet)|sheets\.new/i, terms: ['google-sheets', 'google-workspace', 'cloud spreadsheet'] },
  { pattern: /\b(xlsx|excel|csv|local spreadsheet|helyi t[aá]bl[aá]zat)\b/i, terms: ['local-office', 'spreadsheet-builder', 'csv-cleaner'] },
  { pattern: /\b(docx|word|pdf|document|dokumentum)\b/i, terms: ['local-office', 'document-reader', 'pdf'] },
  { pattern: /\b(github|repo|pr|pull request|issue|branch)\b/i, terms: ['github-maintainer', 'repo-auditor', 'code-reviewer'] },
  { pattern: /landing page|weboldal sz[oö]veg|hero copy/i, terms: ['landing-page-copy', 'content-production'] },
  { pattern: /blog|seo|cikk|article|poszt/i, terms: ['content-production', 'seo-audit'] },
  { pattern: /heti riport|dashboard|analytics|marketing report/i, terms: ['marketing-report', 'data-reporting'] },
  { pattern: /form|űrlap|urlap|browser|webapp/i, terms: ['browser-automation', 'form-filler'] },
];

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenize(value: string): string[] {
  return normalize(value).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
}

function includesPhrase(hay: string, phrase: string): boolean {
  return normalize(hay).includes(normalize(phrase));
}

function explicitMentions(message: string): string[] {
  return [...message.matchAll(/@([a-z0-9][a-z0-9_-]+)/gi)].map((m) => normalize(m[1]));
}

function referenceTerms(refs: DocumentReference[] = []): string[] {
  const terms: string[] = [];
  for (const ref of refs) {
    terms.push(ref.kind);
    const path = ref.path ?? ref.url ?? ref.label;
    if (/\.pdf$/i.test(path)) terms.push('pdf', 'document');
    if (/\.(xlsx|xls|csv)$/i.test(path)) terms.push('excel', 'csv', 'spreadsheet');
    if (/github\.com/i.test(path)) terms.push('github');
    if (/docs\.google\.com\/spreadsheets/i.test(path)) terms.push('google-sheets');
    if (/docs\.google\.com\/document/i.test(path)) terms.push('google-docs');
  }
  return terms;
}

function missingFor(manifest: RichSkillManifest, input: SkillRouterInput): MissingRequirement[] {
  const tools = new Set(input.availableTools);
  const connections = new Set(input.availableConnections);
  const out: MissingRequirement[] = [];
  for (const tool of manifest.allowedTools) {
    if (tool && !tools.has(tool)) out.push({ kind: 'tool', id: tool, reason: `${manifest.name} requires unavailable tool ${tool}.` });
  }
  for (const connection of manifest.requiredConnections) {
    if (connection && !connections.has(connection)) out.push({ kind: 'connection', id: connection, reason: `${manifest.name} requires ${connection}.` });
  }
  if (manifest.status === 'blocked' || manifest.status === 'disabled') {
    out.push({ kind: 'status', id: manifest.status, reason: `${manifest.name} is ${manifest.status}.` });
  }
  return out;
}

function enabled(manifest: RichSkillManifest, enabledSkillIds: string[]): boolean {
  if (!enabledSkillIds.length) return manifest.enabledByDefault && manifest.status !== 'disabled' && manifest.status !== 'blocked';
  return enabledSkillIds.includes(manifest.id) || enabledSkillIds.includes(manifest.name);
}

function score(manifest: RichSkillManifest, input: SkillRouterInput): { score: number; reasons: string[] } {
  const task = `${input.task} ${input.userMessage}`;
  const mentions = explicitMentions(input.userMessage);
  const expandedTerms = SYNONYMS.flatMap((s) => s.pattern.test(task) ? s.terms : []);
  const refTerms = referenceTerms(input.references);
  const hayTokens = new Set([
    ...tokenize(manifest.name),
    ...manifest.categories.flatMap(tokenize),
    ...manifest.tags.flatMap(tokenize),
    ...manifest.trigger.flatMap(tokenize),
    ...tokenize(manifest.description),
    ...manifest.whenToUse.flatMap(tokenize),
  ]);
  const taskTokens = new Set([...tokenize(task), ...expandedTerms.flatMap(tokenize), ...refTerms.flatMap(tokenize)]);
  const reasons: string[] = [];
  let raw = 0;

  if (mentions.includes(normalize(manifest.name)) || mentions.includes(normalize(manifest.id.split(':').pop() ?? manifest.id))) {
    raw += 100;
    reasons.push('explicit @skill mention');
  }

  for (const phrase of manifest.trigger) {
    if (phrase.length >= 3 && includesPhrase(task, phrase)) {
      raw += phrase.includes(' ') ? 10 : 5;
      reasons.push(`trigger "${phrase}"`);
    }
  }
  if (includesPhrase(task, manifest.name)) {
    raw += 12;
    reasons.push('skill name match');
  }
  for (const token of taskTokens) {
    if (hayTokens.has(token)) raw += 1.2;
  }
  for (const phrase of manifest.whenToUse) {
    if (phrase && includesPhrase(task, phrase)) raw += 4;
  }
  for (const phrase of manifest.whenNotToUse) {
    if (phrase && includesPhrase(task, phrase)) {
      raw -= 10;
      reasons.push('negative when-not-to-use match');
    }
  }
  if (expandedTerms.some((term) => includesPhrase(manifest.name, term) || manifest.trigger.some((t) => includesPhrase(t, term)))) {
    raw += 8;
    reasons.push('language/domain synonym match');
  }
  if (/google/i.test(task) && manifest.requiredConnections.includes('google-workspace')) raw += 8;
  if (/github|pull request|\bpr\b|repo/i.test(task) && manifest.requiredConnections.includes('github')) raw += 8;
  if (/notion/i.test(task) && manifest.requiredConnections.includes('notion')) raw += 8;
  if (manifest.source === 'workspace' || manifest.source === 'user') raw += 10;
  if (/google.*(sheet|sheets|tablazat|t[aá]bl[aá]zat)|sheets\.new/i.test(task) && manifest.name === 'google-sheets') raw += 24;
  if (/google.*(sheet|sheets|tablazat|t[aá]bl[aá]zat)|sheets\.new/i.test(task) && manifest.name === 'google-workspace') raw -= 10;
  if (/(github|pull request|\bpr\b|repo)/i.test(task) && manifest.name === 'github-maintainer') raw += 24;
  if (/\b(move|rename|organize|sort|clean|rendez|folder|mappa)\b/i.test(task) && ['file-organizer', 'folder-cleanup'].includes(manifest.name)) raw += 16;
  if (manifest.name === 'folder-watch-processor' && !/\b(watch|automation|trigger|new file|changed file|figyel|automacio)\b/i.test(task)) raw -= 30;
  if (input.currentSurface && input.currentSurface !== 'unknown') {
    const surfaceMatch =
      (input.currentSurface === 'google_workspace' && manifest.requiredConnections.includes('google-workspace')) ||
      (input.currentSurface === 'github' && manifest.requiredConnections.includes('github')) ||
      (input.currentSurface === 'notion' && manifest.requiredConnections.includes('notion')) ||
      (input.currentSurface === 'browser' && manifest.allowedTools.some((t) => t.startsWith('browser.'))) ||
      (input.currentSurface === 'local_files' && manifest.allowedTools.some((t) => t.startsWith('file.') || t.startsWith('document.') || t.startsWith('sheet.')));
    if (surfaceMatch) raw += 5;
  }
  if (input.recentTaskHistory?.some((h) => h.outcome === 'failed' && h.failedSkillIds?.includes(manifest.id))) raw -= 6;
  raw += RISK_WEIGHT[manifest.risk] ?? 0;

  const missing = missingFor(manifest, input);
  const hardMissing = missing.filter((m) => m.kind === 'connection' || m.kind === 'status').length;
  if (hardMissing) raw *= 0.72;
  return { score: raw, reasons };
}

export function routeSkills(manifests: RichSkillManifest[], input: SkillRouterInput): SkillRouterResult {
  const routes = manifests
    .filter((manifest) => enabled(manifest, input.enabledSkillIds))
    .map((manifest) => {
      const s = score(manifest, input);
      const missingRequirements = missingFor(manifest, input);
      return {
        skillId: manifest.id,
        name: manifest.name,
        score: s.score,
        confidence: Math.max(0, Math.min(1, s.score / 18)),
        reason: s.reasons.slice(0, 3).join(', ') || 'matched task wording',
        missingRequirements,
        manifest,
      };
    })
    .filter((route) => route.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = routes.slice(0, 5);
  const primary = selected[0];
  const missing = selected.flatMap((s) => s.missingRequirements);
  return {
    selectedSkills: selected,
    primarySkill: primary,
    confidence: primary?.confidence ?? 0,
    reason: primary ? `${primary.name}: ${primary.reason}` : 'No confident skill match.',
    missingRequirements: missing,
    shouldAskUser: missing.some((m) => m.kind === 'connection' || m.kind === 'status'),
  };
}

export function renderSkillRoutePrompt(result: SkillRouterResult): string {
  if (!result.selectedSkills.length) return '';
  const lines = result.selectedSkills.map((route) => {
    const missing = route.missingRequirements.length
      ? ` Missing: ${route.missingRequirements.map((m) => `${m.kind}:${m.id}`).join(', ')}.`
      : '';
    return `- ${route.name} (${Math.round(route.confidence * 100)}%): ${route.manifest.description}.${missing}`;
  });
  return [
    '## Relevant skills',
    'Runtime rule: if the primary skill confidence is at least 60%, skill.run must happen before improvising. Explicit @skill mentions must be loaded unless disabled/blocked.',
    `Primary: ${result.primarySkill?.name ?? 'none'} (${Math.round(result.confidence * 100)}%)`,
    `Reason: ${result.reason}`,
    ...lines,
  ].join('\n');
}
