import { describe, expect, it } from 'vitest';
import { listRichSkillManifests, loadAllSkills } from '../runner';
import { toRichManifest } from '../manifest';
import { isSkillEnabled, rankSkillsForTask, renderRelevantSkills } from '../ranking';

describe('rich skill manifest', () => {
  it('still loads all bundled skills', () => {
    const skills = loadAllSkills();
    expect(skills.length).toBeGreaterThan(5);
    expect(skills.every((s) => s.enabled)).toBe(true);
  });

  it('derives id, version, categories and a verification checklist', () => {
    const manifest = toRichManifest(loadAllSkills()[0]);
    expect(manifest.id).toMatch(/^bundled:/);
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.categories.length).toBeGreaterThan(0);
    expect(manifest.verificationChecklist.length).toBeGreaterThan(0);
    expect(manifest.enabledByDefault).toBe(true);
  });

  it('exposes rich manifests for every skill', () => {
    expect(listRichSkillManifests().length).toBe(loadAllSkills().length);
  });
});

describe('skill ranking', () => {
  const manifests = listRichSkillManifests();

  it('ranks the github skill highest for a github task', () => {
    const ranked = rankSkillsForTask(manifests, 'open a pull request on the github repo', {
      availableConnectionIds: ['github'],
    });
    expect(ranked[0].manifest.name).toBe('github-maintainer');
  });

  it('flags skills whose required connection is missing', () => {
    const ranked = rankSkillsForTask(manifests, 'open a pull request on the github repo', {
      availableConnectionIds: [],
    });
    const gh = ranked.find((r) => r.manifest.name === 'github-maintainer');
    expect(gh?.missingConnection).toBe(true);
  });

  it('respects workspace enabled set', () => {
    const onlyFiles = manifests.find((m) => m.name === 'file-organizer')!;
    expect(isSkillEnabled(onlyFiles, { enabledSkillIds: [onlyFiles.id] })).toBe(true);
    expect(isSkillEnabled(onlyFiles, { enabledSkillIds: ['bundled:something-else'] })).toBe(false);
  });

  it('renders a compact relevant-skills prompt block', () => {
    const ranked = rankSkillsForTask(manifests, 'organize my downloads folder', {});
    const block = renderRelevantSkills(ranked);
    expect(block).toMatch(/Relevant skills/);
    expect(block).toMatch(/file-organizer/);
  });
});
