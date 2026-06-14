import { describe, expect, it } from 'vitest';
import { assessRisk, commandRisk, decide, isDangerousCommand } from '../policy';

describe('policy & risk', () => {
  it('classifies command risk', () => {
    expect(commandRisk('git status')).toBe('read_only');
    expect(commandRisk('npm install left-pad')).toBe('process_exec');
    expect(commandRisk('rm -rf /')).toBe('destructive');
  });

  it('detects dangerous commands', () => {
    expect(isDangerousCommand('rm -rf node_modules')).toBe(true);
    expect(isDangerousCommand('del /s C:\\\\temp')).toBe(true);
    expect(isDangerousCommand('ls')).toBe(false);
  });

  it('assesses action risk', () => {
    expect(assessRisk({ action: 'file.read', path: 'a' })).toBe('read_only');
    expect(assessRisk({ action: 'file.delete', path: 'a' })).toBe('destructive');
    expect(assessRisk({ action: 'browser.click', target: 'Save' })).toBe('external_write');
    expect(assessRisk({ action: 'connection.call', connection: 'slack', tool: 'send_message', args: {} })).toBe('external_send');
  });

  it('decides auto vs ask', () => {
    expect(decide({ action: 'file.read', path: 'a' }).decision).toBe('auto');
    expect(decide({ action: 'file.delete', path: 'a' }).decision).toBe('ask');
    expect(decide({ action: 'cli.run', cmd: 'rm -rf x' }).decision).toBe('ask');
  });
});
