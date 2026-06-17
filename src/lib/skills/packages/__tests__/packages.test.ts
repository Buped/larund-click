import { describe, expect, it } from 'vitest';
import { loadAllSkills } from '../../runner';
import { skillToPackage } from '../adapter';
import { renderSkillPackageForAgent, summarizeSkillPackage } from '../runtime';

describe('skill packages', () => {
  it('adapts built-in skills into the unified SkillPackage shape with full bodies', () => {
    const taskVerification = loadAllSkills().find((s) => s.manifest.name === 'task-verification');
    expect(taskVerification).toBeTruthy();

    const pkg = skillToPackage(taskVerification!);
    expect(pkg.source).toBe('built_in');
    expect(pkg.instructionBody).toContain('Never trust task.complete without evidence');
    expect(pkg.verificationChecklist.length).toBeGreaterThan(0);
    expect(pkg.examples.length).toBeGreaterThan(0);
  });

  it('keeps summaries compact and renders full packages only when loaded', () => {
    const pkg = skillToPackage(loadAllSkills()[0]);
    const summary = summarizeSkillPackage(pkg);
    expect(summary).not.toHaveProperty('instructionBody');

    const rendered = renderSkillPackageForAgent(pkg);
    expect(rendered).toContain('### Full instructions');
    expect(rendered).toContain(pkg.instructionBody.slice(0, 20));
  });
});
