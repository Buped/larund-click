import { describe, expect, it } from 'vitest';
import { CONTROL_SYSTEM_PROMPT } from '../prompt';
import { isLegacyVisualActionName, parseControlAction } from '../parser';

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

  it('prompt declares structured visualization and no legacy tools', () => {
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('mouse_click');
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('soc.visual');
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('desktop_click_point');
    expect(CONTROL_SYSTEM_PROMPT).toContain('visualization.render');
    expect(CONTROL_SYSTEM_PROMPT).toContain('CHAT-NATIVE VISUALIZATION');
    expect(CONTROL_SYSTEM_PROMPT).toMatch(/not thinking/i);
    expect(CONTROL_SYSTEM_PROMPT).toMatch(/two-point line/i);
  });

  it('prompt requires professional Excel report output for XLSX requests', () => {
    expect(CONTROL_SYSTEM_PROMPT).toContain('EXCEL REPORT STANDARD');
    expect(CONTROL_SYSTEM_PROMPT).toMatch(/default\s+to\s+\.xlsx/i);
    expect(CONTROL_SYSTEM_PROMPT).toContain('meg minden ilyesmi');
    expect(CONTROL_SYSTEM_PROMPT).toMatch(/minimum 50/i);
    expect(CONTROL_SYSTEM_PROMPT).toContain('native Excel Table');
    expect(CONTROL_SYSTEM_PROMPT).toMatch(/summary\s+sheet/i);
    expect(CONTROL_SYSTEM_PROMPT).toContain('visible static');
    expect(CONTROL_SYSTEM_PROMPT).toContain('LibreOffice');
    expect(CONTROL_SYSTEM_PROMPT).toContain('sheet.add_table');
    expect(CONTROL_SYSTEM_PROMPT).toContain('sheet.add_chart');
    expect(CONTROL_SYSTEM_PROMPT).toMatch(/sheet\.read or sheet\.to_json/i);
  });
});
