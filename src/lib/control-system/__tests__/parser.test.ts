import { describe, expect, it } from 'vitest';
import { CONTROL_SYSTEM_PROMPT } from '../prompt';
import { isLegacyVisualActionName, parseControlAction } from '../parser';

describe('no-mouse parser', () => {
  it('accepts structured no-mouse actions', () => {
    expect(parseControlAction('Run it.\n{"action":"cli.run","cmd":"git status"}')).toEqual({ action: 'cli.run', cmd: 'git status' });
    expect(parseControlAction('{"action":"file.mkdir","path":"~/Acme","recursive":true}')).toEqual({ action: 'file.mkdir', path: '~/Acme', recursive: true });
    expect(parseControlAction('{"action":"connection.call","connection":"github","tool":"read_file","args":{}}'))
      .toEqual({ action: 'connection.call', connection: 'github', tool: 'read_file', args: {} });
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

  it('prompt declares the no-mouse contract and no legacy tools', () => {
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('mouse_click');
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('soc.visual');
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('desktop_click_point');
    expect(CONTROL_SYSTEM_PROMPT.toLowerCase()).toContain('never use a mouse');
  });
});
