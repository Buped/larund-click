import { describe, expect, it } from 'vitest';
import { createFailureMemory, isRepeatedFailedClick, rememberFailedOperation, shouldBlockDone } from '../history';
import { routeHighLevel } from '../router';

describe('SOC history and router', () => {
  it('blocks repeated failed click points', () => {
    let memory = createFailureMemory();
    memory = rememberFailedOperation(memory, { thought: 'try', operation: 'click_text', text: 'Ground War' }, 1, 'no_visual_change', { x: 100, y: 200 });
    expect(isRepeatedFailedClick(memory, { x: 112, y: 209 })).toBe(true);
    expect(memory.failedTextClicks[0].text).toBe('Ground War');
  });

  it('routes GUI/game tasks to SOC after app launch and keeps file tasks in CLI', () => {
    expect(routeHighLevel('Nyisd meg a Robloxot es kattints a Ground War jatekra', { action: 'app.open', name: 'Roblox' }, 'opened')).toBe('soc_visual');
    expect(routeHighLevel('Create a file named notes.txt')).toBe('cli');
  });

  it('blocks done when Roblox is only launched', () => {
    const reason = shouldBlockDone([], 'Nyisd meg a Robloxot es lepj be a Ground War jatekba', 'Roblox opened');
    expect(reason).toBe('done_before_any_visual_interaction');
  });
});
