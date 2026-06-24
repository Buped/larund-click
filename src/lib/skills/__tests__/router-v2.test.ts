import { describe, expect, it } from 'vitest';
import { listRichSkillManifests } from '../runner';
import { routeSkills } from '../router';
import { TOOL_CATALOG } from '../../tools/registry';

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

  it('does NOT pull in code execution for a simple total (sheet.query territory)', () => {
    const result = route('Mennyi az osszesen ebben a tablazatban az Osszeg oszlopban?');
    expect(result.primarySkill?.name).not.toBe('data-analysis-and-code');
  });

  it('explicit @skill wins', () => {
    const result = route('@landing-page-copy Irj rovid weboldal szoveget.');
    expect(result.primarySkill?.name).toBe('landing-page-copy');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
