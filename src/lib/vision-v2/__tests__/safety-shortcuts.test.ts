import { describe, it, expect } from 'vitest';
import { classifyRisk } from '../safety';
import { suggestShortcut, shortcutsForWindow } from '../shortcuts';
import type { ActionPlan } from '../types';

function plan(p: Partial<ActionPlan> & { action: ActionPlan['action'] }): ActionPlan {
  return { reason: '', confidence: 0.9, ...p };
}

describe('classifyRisk', () => {
  it('flags delete/pay/send/password as high risk', () => {
    expect(classifyRisk(plan({ action: 'click_text', target: { text: 'Delete account' } })).level).toBe('high');
    expect(classifyRisk(plan({ action: 'click_element', text: 'Pay now' })).level).toBe('high');
    expect(classifyRisk(plan({ action: 'click_text', target: { text: 'Send email' } })).level).toBe('high');
    expect(classifyRisk(plan({ action: 'type_text', text: 'my password is hunter2' })).level).toBe('high');
  });

  it('treats ordinary navigation as low risk', () => {
    expect(classifyRisk(plan({ action: 'click_text', target: { text: 'Extensions' } })).level).toBe('low');
    expect(classifyRisk(plan({ action: 'hotkey', keys: ['ctrl', 'l'] })).level).toBe('low');
    expect(classifyRisk(plan({ action: 'scroll' })).level).toBe('low');
  });
});

describe('shortcuts registry', () => {
  it('finds VS Code Extensions shortcut', () => {
    const sc = suggestShortcut('myproj - Visual Studio Code', 'extensions');
    expect(sc?.keys).toEqual(['ctrl', 'shift', 'x']);
  });

  it('matches by keyword for the browser address bar', () => {
    const sc = suggestShortcut('Google Chrome', 'open the address bar', 'chrome');
    expect(sc?.keys).toEqual(['ctrl', 'l']);
  });

  it('returns nothing for an unknown app', () => {
    expect(shortcutsForWindow('Some Random App').length).toBe(0);
    expect(suggestShortcut('Some Random App', 'extensions')).toBeNull();
  });
});
