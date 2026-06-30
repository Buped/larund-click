import { describe, expect, it } from 'vitest';
import {
  assessRisk,
  commandRisk,
  decide,
  isDangerousCommand,
  policyForAutonomyMode,
  FULL_AUTONOMY_POLICY,
  MANUAL_POLICY,
} from '../policy';

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

  describe('semi-autonomous hybrid (AI-judged + safety floor)', () => {
    const semi = policyForAutonomyMode('semi');

    it('always asks for the irreversible safety floor, even when unflagged', () => {
      expect(decide({ action: 'file.delete', path: 'a' }, semi, 'semi').decision).toBe('ask');
      expect(decide({ action: 'connection.call', connection: 'slack', tool: 'send_message', args: {} }, semi, 'semi').decision).toBe('ask');
      expect(decide({ action: 'browser.login', app_id: 'x' } as never, semi, 'semi').decision).toBe('ask');
    });

    it('auto-runs reversible middle-ground actions the model did not flag', () => {
      expect(decide({ action: 'file.move', from: 'a', to: 'b' }, semi, 'semi').decision).toBe('auto');
      expect(decide({ action: 'browser.click', target: 'Save' }, semi, 'semi').decision).toBe('auto');
    });

    it('asks for middle-ground actions the model flagged as critical', () => {
      expect(decide({ action: 'browser.click', target: 'Pay now', critical: true } as never, semi, 'semi').decision).toBe('ask');
      expect(decide({ action: 'file.move', from: 'a', to: 'b', critical: true } as never, semi, 'semi').decision).toBe('ask');
    });

    it('still auto-runs read-only actions regardless of flags', () => {
      expect(decide({ action: 'file.read', path: 'a', critical: true } as never, semi, 'semi').decision).toBe('auto');
    });
  });

  describe('full autonomy keeps only the catastrophe floor', () => {
    const full = policyForAutonomyMode('full');

    it('maps to the full-autonomy policy table', () => {
      expect(full).toBe(FULL_AUTONOMY_POLICY);
    });

    it('auto-runs sends and writes without asking', () => {
      expect(decide({ action: 'connection.call', connection: 'slack', tool: 'send_message', args: {} }, full, 'full').decision).toBe('auto');
      expect(decide({ action: 'browser.click', target: 'Save' }, full, 'full').decision).toBe('auto');
    });

    it('still asks for catastrophic shell commands', () => {
      expect(decide({ action: 'cli.run', cmd: 'rm -rf /' }, full, 'full').decision).toBe('ask');
    });
  });

  it('manual mode asks for everything', () => {
    const manual = policyForAutonomyMode('manual');
    expect(manual).toBe(MANUAL_POLICY);
    expect(decide({ action: 'file.read', path: 'a' }, manual, 'manual').decision).toBe('ask');
    expect(decide({ action: 'file.move', from: 'a', to: 'b' }, manual, 'manual').decision).toBe('ask');
  });
});
