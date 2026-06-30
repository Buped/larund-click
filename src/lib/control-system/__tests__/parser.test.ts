import { describe, expect, it } from 'vitest';
import { CONTROL_SYSTEM_PROMPT } from '../prompt';
import { isLegacyVisualActionName, parseControlAction } from '../parser';
import { BUNDLED_SKILL_FILES } from '../../skills/bundled';

// Tool-specific procedural detail now lives in on-demand skill bodies (bundled.ts),
// not the always-injected operator prompt. These helpers find the relevant skill.
const ALL_SKILLS = BUNDLED_SKILL_FILES.join('\n\n');
const skillBody = (name: string) =>
  BUNDLED_SKILL_FILES.find((s) => s.includes(`name: ${name}`) || s.includes(`name: "${name}"`)) ?? '';

describe('no-mouse parser', () => {
  it('accepts structured no-mouse actions', () => {
    expect(parseControlAction('Run it.\n{"action":"cli.run","cmd":"git status"}')).toEqual({ action: 'cli.run', cmd: 'git status' });
    expect(parseControlAction('{"action":"file.mkdir","path":"~/Acme","recursive":true}')).toEqual({ action: 'file.mkdir', path: '~/Acme', recursive: true });
    expect(parseControlAction('{"action":"connection.call","connection":"github","tool":"read_file","args":{}}'))
      .toEqual({ action: 'connection.call', connection: 'github', tool: 'read_file', args: {} });
    expect(parseControlAction('{"action":"visualization.render","title":"Trend","html":"<svg></svg>","height":420}'))
      .toEqual({ action: 'visualization.render', title: 'Trend', html: '<svg></svg>', height: 420 });
  });

  it('accepts browser.login (saved-credential sign-in)', () => {
    expect(parseControlAction('Sign in.\n{"action":"browser.login","app_id":"app-1"}'))
      .toEqual({ action: 'browser.login', app_id: 'app-1' });
    expect(parseControlAction('{"action":"browser.login","domain":"shopify.com"}'))
      .toEqual({ action: 'browser.login', domain: 'shopify.com' });
  });

  it('rejects every mouse / cursor / visual / SOC action', () => {
    expect(parseControlAction('{"action":"soc.visual","objective":"click"}')).toBeNull();
    expect(parseControlAction('{"tool":"mouse_click","x":1,"y":2}')).toBeNull();
    expect(parseControlAction('{"action":"desktop_click_point","x":1,"y":2}')).toBeNull();
    expect(parseControlAction(JSON.stringify({ action: `visual.${'clickIntent'}`, target: 'X' }))).toBeNull();
    expect(parseControlAction('{"action":"cursor.move","x":1}')).toBeNull();
    expect(parseControlAction('{"action":"ground_visual_target","target":"X"}')).toBeNull();
  });

  it('migration guard flags legacy names', () => {
    for (const n of ['mouse_click', 'desktop_click_point', 'soc.visual', 'visual.clickIntent', 'cursor.move', 'click_visual_target', 'ground_visual_target']) {
      expect(isLegacyVisualActionName(n)).toBe(true);
    }
    expect(isLegacyVisualActionName('cli.run')).toBe(false);
    expect(isLegacyVisualActionName('file.move')).toBe(false);
  });

  it('prompt declares structured visualization, core contract, skills pointer and no legacy tools', () => {
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('mouse_click');
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('soc.visual');
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('desktop_click_point');
    // visualization.render stays a core always-available action shape.
    expect(CONTROL_SYSTEM_PROMPT).toContain('visualization.render');
    expect(CONTROL_SYSTEM_PROMPT).toMatch(/CHAT VISUALIZATION/);
    // The slimmed prompt keeps the output contract + the on-demand skills pointer.
    expect(CONTROL_SYSTEM_PROMPT).toContain('skill.run');
    expect(CONTROL_SYSTEM_PROMPT).toContain('COMPLETION CHECKLIST');
    expect(CONTROL_SYSTEM_PROMPT).toMatch(/USE SKILLS/i);
  });

  it('moved the full chat-visualization standard into its skill body', () => {
    const viz = skillBody('chat-visualization');
    expect(viz).toContain('visualization.render');
    expect(viz).toMatch(/not thinking/i);
    expect(viz).toMatch(/two-point line/i);
    expect(viz).toContain('#f4f0ea');
  });

  it('moved the professional Excel report standard into the local-office skill body', () => {
    const office = skillBody('local-office');
    expect(office).toMatch(/\.xlsx by default|default\s+to\s+\.xlsx/i);
    expect(office).toContain('native Excel Table');
    expect(office).toMatch(/summary\s+sheet/i);
    expect(office).toContain('LibreOffice');
    expect(office).toContain('sheet.add_table');
    expect(office).toContain('sheet.add_chart');
    // The richer report wording and minimum-rows rule remain reachable somewhere in the catalog.
    expect(ALL_SKILLS).toContain('meg minden ilyesmi');
    expect(ALL_SKILLS).toMatch(/minimum 50/i);
  });
});
