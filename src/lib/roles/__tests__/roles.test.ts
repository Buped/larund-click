import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLES, getRoleTemplate } from '../templates';
import { renderRolePrompt } from '../prompt';
import { listRichSkillManifests } from '../../skills/runner';
import { rankSkillsForTask } from '../../skills/ranking';

describe('role templates', () => {
  it('ships the 8 built-in roles, all typed', () => {
    expect(BUILT_IN_ROLES).toHaveLength(8);
    for (const r of BUILT_IN_ROLES) {
      expect(r.id).toBeTruthy();
      expect(r.systemInstructions.length).toBeGreaterThan(20);
      expect(Array.isArray(r.defaultSkills)).toBe(true);
    }
  });

  it('looks up a role by id', () => {
    expect(getRoleTemplate('developer')?.name).toBe('Developer');
    expect(getRoleTemplate('nope')).toBeUndefined();
  });

  it('renders a compact role prompt block', () => {
    const block = renderRolePrompt(getRoleTemplate('qa-verifier')!);
    expect(block).toMatch(/Active role: QA Verifier/);
    expect(block).toMatch(/Prove the requested outcome/);
  });

  it('a selected role influences skill ranking', () => {
    const manifests = listRichSkillManifests();
    const role = getRoleTemplate('developer')!;
    // A neutral task that does not lexically mention github.
    const task = 'help me with the project';
    const withRole = rankSkillsForTask(manifests, task, {
      boostSkillNames: role.defaultSkills,
      boostCategories: role.categories,
    });
    const top = withRole[0]?.manifest.name;
    expect(role.defaultSkills).toContain(top);
  });
});
