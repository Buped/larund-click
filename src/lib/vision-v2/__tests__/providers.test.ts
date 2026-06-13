import { describe, it, expect } from 'vitest';
import { uiaTargetsToElements, type UiaReadResult } from '../providers/uia';
import { parseBrowserRead } from '../providers/dom';

describe('UIA provider normalization', () => {
  const raw: UiaReadResult = {
    window: { title: 'Untitled - Notepad', process_name: 'notepad', bounds: { x: 0, y: 0, width: 800, height: 600 } },
    snapshot_token: 'desktop-snapshot-5',
    targets: [
      { id: 'fg|1.2', name: 'File', role: 'MenuItem', automation_id: null, bounds: { x: 10, y: 10, width: 40, height: 20 },
        enabled: true, visible: true, focused: false, window_title: 'Untitled - Notepad',
        can_invoke: true, can_scroll: false, is_keyboard_focusable: true, target_confidence: 0.8, click_strategy: 'invoke' },
      { id: 'fg|9', name: 'tiny', role: 'Button', automation_id: null, bounds: { x: 0, y: 0, width: 1, height: 1 },
        enabled: true, visible: true, focused: false, window_title: 'x', can_invoke: true, can_scroll: false, is_keyboard_focusable: false },
      { id: 'fg|3', name: 'hidden', role: 'Button', automation_id: null, bounds: { x: 5, y: 5, width: 50, height: 50 },
        enabled: true, visible: false, focused: false, window_title: 'x', can_invoke: true, can_scroll: false, is_keyboard_focusable: false },
    ],
  };

  it('maps a usable target with bbox, center, metadata and snapshot_token', () => {
    const els = uiaTargetsToElements(raw);
    expect(els.length).toBe(1); // tiny + hidden dropped
    const e = els[0];
    expect(e.id).toBe('uia_fg|1.2');
    expect(e.source).toBe('uia');
    expect(e.bbox).toEqual([10, 10, 50, 30]);
    expect(e.center).toEqual([30, 20]);
    expect(e.clickable).toBe(true);
    expect(e.metadata?.snapshot_token).toBe('desktop-snapshot-5');
    expect(e.metadata?.uiaId).toBe('fg|1.2');
    expect(e.metadata?.can_invoke).toBe(true);
  });
});

describe('DOM provider parsing', () => {
  const text = [
    'URL: https://example.com/login',
    'TITLE: Login',
    'CLICKABLE/INPUTS:',
    'a: Sign in',
    'button: Continue',
    'input[email]: Email',
    '',
  ].join('\n');

  it('parses url/title and elements with domTarget metadata', () => {
    const res = parseBrowserRead(text);
    expect(res.url).toBe('https://example.com/login');
    expect(res.title).toBe('Login');
    expect(res.elements.length).toBe(3);
    const signIn = res.elements[0];
    expect(signIn.source).toBe('dom');
    expect(signIn.role).toBe('Hyperlink');
    expect(signIn.name).toBe('Sign in');
    expect(signIn.bbox).toEqual([0, 0, 0, 0]); // no pixels
    expect(signIn.metadata?.domTarget).toBe('Sign in');
    const email = res.elements[2];
    expect(email.role).toBe('Edit');
    expect(email.metadata?.isInput).toBe(true);
  });
});
