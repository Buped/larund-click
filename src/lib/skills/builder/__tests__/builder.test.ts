import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../../coworker/persistence';
import {
  DuplicateSkillNameError,
  createBuilderSkill,
  listBuilderSkills,
  setBuilderSkillEnabled,
} from '../store';
import { compileToMarkdown, compileToSkill, validateBuilderSkill } from '../compiler';
import { dryRunSkill } from '../test-runner';
import { suggestSkillsFromTasks } from '../suggester';
import { loadAllSkillsAsync, listRichSkillManifestsAsync } from '../../runner';
import { rankSkillsForTask } from '../../ranking';
import { TOOL_CATALOG } from '../../../tools/registry';
import type { SkillBuilderSkill } from '../types';

beforeEach(() => {
  resetRecordBackendForTests();
});

const KNOWN_TOOLS = TOOL_CATALOG.map((t) => t.name);

function sampleSkill(over: Partial<SkillBuilderSkill> = {}): SkillBuilderSkill {
  const now = new Date().toISOString();
  return {
    id: 's1', userId: 'u1', name: 'Client Weekly Report', version: '1.0.0',
    description: 'Compile a weekly client report from sheets and write a summary.',
    source: 'workspace', workspaceId: 'ws1',
    triggerPhrases: ['weekly report', 'client report'],
    categories: ['marketing', 'data'],
    whenToUse: ['When a client needs a weekly summary'],
    whenNotToUse: ['Ad-hoc one-off questions'],
    requiredConnections: ['google-workspace'],
    requiredMcpServers: [],
    allowedTools: ['sheet.read', 'file.write', 'connection.call'],
    riskLevel: 'local_write',
    steps: [
      { id: 'st1', title: 'Read data', instruction: 'Read the sales sheet', preferredTools: ['sheet.read'], required: true },
      { id: 'st2', title: 'Write report', instruction: 'Write a markdown report', preferredTools: ['file.write'], required: true, verificationHint: 'read it back' },
    ],
    verificationChecklist: [
      { id: 'v1', title: 'Report file exists', description: 'The report file was written', kind: 'file_exists', required: true },
    ],
    fallbackStrategy: 'Ask the user for missing inputs.',
    examplePrompts: ['create this week client report'],
    exampleRuns: [],
    enabled: true, createdAt: now, updatedAt: now,
    ...over,
  };
}

describe('skill builder compiler', () => {
  it('compiles to valid SKILL.md that the parser accepts', () => {
    const md = compileToMarkdown(sampleSkill());
    expect(md).toMatch(/^---/);
    expect(md).toMatch(/name: "Client Weekly Report"/);
    expect(md).toMatch(/requires_connections: \["google-workspace"\]/);
    const skill = compileToSkill(sampleSkill());
    expect(skill.error).toBeUndefined();
    expect(skill.manifest.name).toBe('Client Weekly Report');
    expect(skill.manifest.allowed_tools).toContain('sheet.read');
    expect(skill.source).toBe('workspace');
  });

  it('validates and rejects mouse/visual tools', () => {
    const bad = sampleSkill({ allowedTools: ['mouse.click', 'file.write'] });
    const v = validateBuilderSkill(bad, KNOWN_TOOLS);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/mouse/i);
  });

  it('warns on unknown tools but stays compilable', () => {
    const v = validateBuilderSkill(sampleSkill({ allowedTools: ['file.write', 'made.up'] }), KNOWN_TOOLS);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/made\.up/);
  });
});

describe('skill builder store', () => {
  it('creates and lists workspace skills', async () => {
    await createBuilderSkill({ userId: 'u1', workspaceId: 'ws1', name: 'A', description: 'a skill' });
    const list = await listBuilderSkills({ userId: 'u1', workspaceId: 'ws1' });
    expect(list).toHaveLength(1);
  });

  it('rejects duplicate names in the same scope', async () => {
    await createBuilderSkill({ userId: 'u1', workspaceId: 'ws1', name: 'Report', description: 'x' });
    await expect(createBuilderSkill({ userId: 'u1', workspaceId: 'ws1', name: 'report', description: 'y' }))
      .rejects.toBeInstanceOf(DuplicateSkillNameError);
  });

  it('scopes workspace skills to their workspace', async () => {
    await createBuilderSkill({ userId: 'u1', workspaceId: 'ws1', name: 'WS1 skill', description: 'x' });
    expect(await listBuilderSkills({ userId: 'u1', workspaceId: 'ws2' })).toHaveLength(0);
    expect(await listBuilderSkills({ userId: 'u1', workspaceId: 'ws1' })).toHaveLength(1);
  });
});

describe('custom skill ranking + runtime integration', () => {
  it('includes enabled custom skills and ranks them for matching tasks', async () => {
    await createBuilderSkill({
      userId: 'u1', workspaceId: 'ws1', name: 'Client Weekly Report',
      description: 'Compile a weekly client report', triggerPhrases: ['weekly report'],
      allowedTools: ['sheet.read', 'file.write'], riskLevel: 'local_write',
    });
    const skills = await loadAllSkillsAsync('u1', 'ws1');
    expect(skills.some((s) => s.manifest.name === 'Client Weekly Report')).toBe(true);

    const manifests = await listRichSkillManifestsAsync('u1', 'ws1');
    const ranked = rankSkillsForTask(manifests, 'make the weekly report for the client', {});
    expect(ranked[0].manifest.name).toBe('Client Weekly Report');
  });

  it('disabled custom skills are not loaded', async () => {
    const s = await createBuilderSkill({ userId: 'u1', workspaceId: 'ws1', name: 'Hidden', description: 'x' });
    await setBuilderSkillEnabled(s.id, false);
    const skills = await loadAllSkillsAsync('u1', 'ws1');
    expect(skills.some((x) => x.manifest.name === 'Hidden')).toBe(false);
  });
});

describe('skill test runner (dry run)', () => {
  it('flags missing connections and never executes', () => {
    const res = dryRunSkill(sampleSkill(), { availableConnectionIds: [], prompt: 'weekly report' });
    expect(res.requiresApprovalToExecute).toBe(true);
    expect(res.missingConnections).toContain('google-workspace');
    expect(res.renderedPlan).toMatch(/Client Weekly Report/);
  });

  it('passes when connection is available', () => {
    const res = dryRunSkill(sampleSkill(), { availableConnectionIds: ['google-workspace'] });
    expect(res.ok).toBe(true);
    expect(res.missingConnections).toHaveLength(0);
  });
});

describe('skill suggestion from repeated tasks', () => {
  it('suggests a skill when a pattern repeats 2+ times', () => {
    const tasks = [
      { taskRunId: 't1', userId: 'u1', workspaceId: 'ws1', title: 'Weekly client report', prompt: 'compile weekly client report from sheets', tools: ['sheet.read', 'file.write'] },
      { taskRunId: 't2', userId: 'u1', workspaceId: 'ws1', title: 'Weekly client report again', prompt: 'compile weekly client report from sheets', tools: ['sheet.read', 'file.write'] },
      { taskRunId: 't3', userId: 'u1', workspaceId: 'ws1', title: 'random unrelated thing', prompt: 'delete temp files', tools: ['file.delete'] },
    ];
    const drafts = suggestSkillsFromTasks(tasks);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].source).toBe('suggested');
    expect(drafts[0].allowedTools).toEqual(expect.arrayContaining(['sheet.read', 'file.write']));
    expect(drafts[0].enabled).toBe(false);
  });

  it('does not suggest for a single occurrence', () => {
    const drafts = suggestSkillsFromTasks([
      { taskRunId: 't1', userId: 'u1', workspaceId: 'ws1', title: 'one off', prompt: 'do a thing once', tools: ['cli.run'] },
    ]);
    expect(drafts).toHaveLength(0);
  });
});
