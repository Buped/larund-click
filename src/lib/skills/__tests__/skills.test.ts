import { describe, expect, it } from 'vitest';
import { parseSkillFile } from '../frontmatter';
import { loadSkillFromMarkdown, mergeSkills, scoreSkill } from '../loader';
import { createSkillRunner, loadAllSkills, findRelevantSkill, listSkillMetadata } from '../runner';

const GOOD = `---
name: demo
description: "A demo skill"
allowed_tools: ["file.read", "file.write"]
requires_connections: ["github"]
risk: "local_write"
---
# Demo
Body here.`;

describe('skills', () => {
  it('parses valid frontmatter', () => {
    const parsed = parseSkillFile(GOOD);
    expect(parsed.manifest?.name).toBe('demo');
    expect(parsed.manifest?.allowed_tools).toEqual(['file.read', 'file.write']);
    expect(parsed.manifest?.requires_connections).toEqual(['github']);
    expect(parsed.manifest?.risk).toBe('local_write');
    expect(parsed.body).toContain('# Demo');
  });

  it('fails on missing frontmatter and invalid risk', () => {
    expect(parseSkillFile('no frontmatter').error).toBe('missing_frontmatter');
    expect(parseSkillFile('---\nname: x\ndescription: y\nrisk: nope\n---\nbody').error).toBe('invalid_risk:nope');
  });

  it('parses rich frontmatter including nested metadata and block lists', () => {
    const parsed = parseSkillFile(`---
name: rich
description: Rich skill
version: "2.0.0"
author: Larund
license: MIT
category: documents
tags: [pdf, "szamla"]
status: pending_review
origin:
  repo: alirezarezvani/claude-skills
  path: examples/rich
metadata:
  owner: ops
when_to_use:
  - Read invoices
when_not_to_use:
  - Google Sheets without connection
verification_checklist:
  - Read back output
required_connections: [google-workspace]
required_mcp_servers: [drive-mcp]
allowed_tools: ["document.read", "connection.call"]
risk: external_write
enabled_by_default: false
supports_automation: true
supports_manual_run: true
---
Body`);
    expect(parsed.error).toBeUndefined();
    expect(parsed.manifest?.version).toBe('2.0.0');
    expect(parsed.manifest?.tags).toEqual(['pdf', 'szamla']);
    expect(parsed.manifest?.requires_connections).toEqual(['google-workspace']);
    expect(parsed.manifest?.origin_repo).toBe('alirezarezvani/claude-skills');
    expect(parsed.manifest?.metadata).toMatchObject({ owner: 'ops' });
    expect(parsed.manifest?.enabled_by_default).toBe(false);
  });

  it('rejects forbidden visual control tools while allowing browser.click', () => {
    expect(parseSkillFile('---\nname: x\ndescription: y\nallowed_tools: ["browser.click"]\nrisk: read_only\n---\nbody').error).toBeUndefined();
    expect(parseSkillFile('---\nname: x\ndescription: y\nallowed_tools: ["mouse.click"]\nrisk: read_only\n---\nbody').error).toBe('forbidden_tool:mouse.click');
  });

  it('applies precedence: workspace overrides bundled', () => {
    const bundled = loadSkillFromMarkdown(GOOD, 'bundled');
    const ws = loadSkillFromMarkdown(GOOD.replace('A demo skill', 'WS override'), 'workspace');
    const merged = mergeSkills([bundled], [ws]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('workspace');
    expect(merged[0].manifest.description).toContain('WS override');
  });

  it('loads the expanded bundled catalog incl. expected names', () => {
    const all = loadAllSkills();
    expect(all.length).toBeGreaterThanOrEqual(60);
    const names = all.map((s) => s.manifest.name);
    for (const n of ['file-organizer', 'browser-automation', 'vscode-project', 'github-maintainer', 'marketing-report']) {
      expect(names).toContain(n);
    }
    for (const n of ['document-accounting', 'google-docs', 'local-office', 'google-sheets', 'google-workspace', 'task-verification']) {
      expect(names).toContain(n);
    }
  });

  it('lists and runs newly bundled office/accounting skills', async () => {
    const names = listSkillMetadata().map((s) => s.name);
    expect(names).toContain('document-accounting');
    expect(names).toContain('google-docs');
    expect(names).toContain('local-office');

    const result = await createSkillRunner().run('document-accounting');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Document Accounting');
    expect(result.details?.runtimeContext).toMatchObject({
      name: 'document-accounting',
      allowedTools: expect.arrayContaining(['document.read', 'sheet.read']),
      risk: 'local_write',
    });
  });

  it('finds a relevant skill by trigger', () => {
    const skill = findRelevantSkill('Please organize my downloads folder into categories');
    expect(skill?.manifest.name).toBe('file-organizer');
    expect(scoreSkill(loadSkillFromMarkdown(GOOD, 'bundled'), 'demo skill')).toBeGreaterThan(0);
  });

  it('finds invoice accounting Google Sheets skill for Hungarian accounting task', () => {
    const skill = findRelevantSkill('szamla konyveles Google Sheets');
    expect(['document-accounting', 'google-sheets']).toContain(skill?.manifest.name);
  });
});
