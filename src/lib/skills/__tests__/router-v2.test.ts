import { describe, expect, it } from 'vitest';
import { listRichSkillManifests } from '../runner';
import { routeSkills } from '../router';
import { TOOL_CATALOG } from '../../tools/registry';
import type { RichSkillManifest } from '../manifest';

const tools = TOOL_CATALOG.map((tool) => tool.name);

function route(task: string, connections: string[] = []) {
  return routeSkills(listRichSkillManifests(), {
    task,
    userMessage: task,
    availableTools: tools,
    availableConnections: connections,
    enabledSkillIds: [],
    currentSurface: 'unknown',
  });
}

describe('skill router v2', () => {
  it('routes Hungarian invoice accounting to document-accounting', () => {
    const result = route('Olvasd el ezt a szamlamappat es keszits belole konyvelesi xlsx-et.');
    expect(result.selectedSkills.map((s) => s.name)).toContain('document-accounting');
    expect(result.primarySkill?.name).toBe('document-accounting');
  });

  it('routes Google spreadsheet to google-sheets, not local-office', () => {
    const result = route('Keszits egy uj Google tablazatot 5 pelda ugyfeladattal.', ['google-workspace']);
    expect(result.primarySkill?.name).toBe('google-sheets');
  });

  it('routes local xlsx to local-office instead of google-sheets', () => {
    const result = route('Keszits egy helyi xlsx riportot 5 sor adattal.');
    expect(['local-office', 'xlsx-reporter', 'spreadsheet-builder']).toContain(result.primarySkill?.name);
    expect(result.primarySkill?.name).not.toBe('google-sheets');
  });

  it('routes GitHub PR task to github-maintainer', () => {
    const result = route('Nezd at a GitHub PR-t es irj review javaslatokat.', ['github']);
    expect(result.primarySkill?.name).toBe('github-maintainer');
  });

  it('routes blog post to content-production', () => {
    expect(route('Irj egy SEO blog postot a Larund Clickrol.').primarySkill?.name).toBe('content-production');
  });

  it('routes landing page copy to landing-page-copy', () => {
    expect(route('Irj landing page hero copyt es weboldal szoveget.').primarySkill?.name).toBe('landing-page-copy');
  });

  it('routes browser form task to browser-automation or form-filler', () => {
    const primary = route('Toltsd ki ezt a web formot a bongeszoben.').primarySkill?.name;
    expect(['browser-automation', 'form-filler']).toContain(primary);
  });

  it('routes local file move tasks to a file organization skill', () => {
    const primary = route('Create a folder on my desktop and move every txt file to it.').primarySkill?.name;
    expect(['file-organizer', 'folder-cleanup']).toContain(primary);
  });

  it('reports missing Google connection as blocker while keeping the right skill', () => {
    const result = route('Keszits egy Google Sheetet pelda adatokkal.');
    expect(result.primarySkill?.name).toBe('google-sheets');
    expect(result.missingRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'connection', id: 'google-workspace' }),
    ]));
    expect(result.shouldAskUser).toBe(true);
  });

  it('routes a correlation analysis question to data-analysis-and-code', () => {
    const result = route('Van-e korrelacio a kampanykoltes es a konverziok kozott ebben a tablazatban?');
    expect(result.selectedSkills.map((s) => s.name)).toContain('data-analysis-and-code');
    expect(result.primarySkill?.name).toBe('data-analysis-and-code');
  });

  it('routes a chart/outlier request to data-analysis-and-code', () => {
    const result = route('Keress kiugro ertekeket es rajzolj egy oszlopdiagramot a havi bevetelekrol.');
    expect(result.selectedSkills.map((s) => s.name)).toContain('data-analysis-and-code');
  });

  it('routes office result pack tasks', () => {
    expect(route('Nezd at az emailjeim es keszits valasz piszkozatot.', ['google-workspace']).primarySkill?.name).toBe('email-ops');
    expect(route('Masold at a HubSpot kontaktokat Google Sheetsbe.', ['hubspot', 'google-workspace']).selectedSkills.map((s) => s.name)).toContain('data-transfer-ops');
    expect(route('A meeting jegyzet alapjan frissitsd a CRM-et es irj follow-up draftot.', ['hubspot']).selectedSkills.map((s) => s.name)).toContain('meeting-to-actions');
    expect(route('Frissitsd ezt a Google Sheets tablazatot es olvasd vissza.', ['google-workspace']).selectedSkills.map((s) => s.name)).toContain('spreadsheet-refresh');
  });

  it('does NOT pull in code execution for a simple total (sheet.query territory)', () => {
    const result = route('Mennyi az osszesen ebben a tablazatban az Osszeg oszlopban?');
    expect(result.primarySkill?.name).not.toBe('data-analysis-and-code');
  });

  it('routes a web research / latest-news task to web-research-standard', () => {
    const result = route('Keresd meg az interneten a legfrissebb híreket a magyar AI piacról és add meg a forrásokat.');
    expect(result.selectedSkills.map((s) => s.name)).toContain('web-research-standard');
  });

  it('routes an email compose/draft task to an email skill', () => {
    const result = route('Írj egy emailt az ügyfélnek és készíts piszkozatot.', ['google-workspace']);
    expect(['email-ops', 'gmail-draft-and-send']).toContain(result.primarySkill?.name);
  });

  it('routes a PDF/PPTX generation task to an artifact skill', () => {
    const pdf = route('Készíts egy szép letölthető PDF üzleti riportot a Q2 számokról.');
    expect(pdf.selectedSkills.map((s) => s.name).some((n) => n.startsWith('artifact-') || n === 'artifact-pdf-document' || n === 'artifact-business-report')).toBe(true);
    const pptx = route('Csinálj egy 8 diás pptx prezentációt a termékről.');
    expect(pptx.selectedSkills.map((s) => s.name)).toContain('artifact-presentation');
  });

  it('routes a chat chart/diagram request to chat-visualization', () => {
    const result = route('Rajzolj egy diagramot a chatbe a havi bevételek alakulásáról, ábra formában.');
    expect(result.selectedSkills.map((s) => s.name)).toContain('chat-visualization');
  });

  it('explicit @skill wins', () => {
    const result = route('@landing-page-copy Irj rovid weboldal szoveget.');
    expect(result.primarySkill?.name).toBe('landing-page-copy');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('builds an app profile -> workflow -> verification skill chain', () => {
    const manifests = [
      manifest({
        id: 'workspace:App Profile: acme.test',
        name: 'App Profile: acme.test',
        kind: 'app_profile',
        description: 'Learned controls for acme.test',
        target: { domain: 'acme.test', urlPatterns: ['*://acme.test/*'] },
        allowedTools: ['browser.open', 'browser.read'],
        risk: 'external_read',
      }),
      manifest({
        id: 'workspace:Acme form workflow',
        name: 'Acme form workflow',
        description: 'Fill Acme forms',
        trigger: ['acme', 'form'],
        allowedTools: ['browser.open', 'browser.type', 'browser.read'],
        risk: 'external_write',
      }),
      manifest({
        id: 'bundled:task-verification',
        name: 'task-verification',
        description: 'Verify task output',
        trigger: ['verify'],
        allowedTools: ['browser.read'],
        risk: 'read_only',
      }),
    ];
    const result = routeSkills(manifests, {
      task: 'Open https://acme.test/form and fill the Acme form',
      userMessage: 'Open https://acme.test/form and fill the Acme form',
      availableTools: tools,
      availableConnections: [],
      enabledSkillIds: [],
      currentSurface: 'browser',
    });
    expect(result.selectedChain.map((s) => s.name)).toEqual([
      'App Profile: acme.test',
      'Acme form workflow',
      'task-verification',
    ]);
  });
});

function manifest(overrides: Partial<RichSkillManifest>): RichSkillManifest {
  return {
    id: 'bundled:test',
    name: 'test',
    version: '1.0.0',
    description: 'test',
    trigger: [],
    categories: ['test'],
    allowedTools: [],
    requiredConnections: [],
    requiredMcpServers: [],
    risk: 'read_only',
    verificationChecklist: ['Read back result'],
    whenToUse: [],
    whenNotToUse: [],
    enabledByDefault: true,
    source: 'workspace',
    tags: [],
    supportsAutomation: true,
    supportsManualRun: true,
    kind: 'workflow',
    ...overrides,
  };
}
