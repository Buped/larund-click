import { describe, expect, it } from 'vitest';
import { CONTROL_SYSTEM_PROMPT } from '../prompt';
import { isRawMouseActionName, parseControlAction } from '../parser';

describe('control-system parser and prompt', () => {
  it('accepts SOC visual handoff', () => {
    expect(parseControlAction('Ok.\n{"action":"soc.visual","objective":"Click Ground War in Roblox"}')).toEqual({
      action: 'soc.visual',
      objective: 'Click Ground War in Roblox',
    });
  });

  it('rejects legacy raw mouse tool calls', () => {
    expect(parseControlAction('{"tool":"mouse_click","x":1,"y":2}')).toBeNull();
    expect(parseControlAction('{"action":"visual.clickIntent","target":"Ground War"}')).toBeNull();
    expect(isRawMouseActionName('mouse_click')).toBe(true);
    expect(isRawMouseActionName('desktop_click_point')).toBe(true);
    expect(isRawMouseActionName('visual.clickIntent')).toBe(true);
  });

  it('does not advertise raw mouse tools in the planner prompt', () => {
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('mouse_click');
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('desktop_click_point');
    expect(CONTROL_SYSTEM_PROMPT).not.toContain('visual.clickIntent');
    expect(CONTROL_SYSTEM_PROMPT).toContain('soc.visual');
  });
});
