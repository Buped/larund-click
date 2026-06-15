import { describe, expect, it } from 'vitest';
import { evaluateSandbox } from '../enforcer';
import { getSandboxProfile } from '../profiles';

describe('sandbox profiles', () => {
  it('blocks process exec and credential access unless allowed', () => {
    const strict = getSandboxProfile('strict-read-only');
    expect(evaluateSandbox({ profile: strict, risk: 'process_exec' }).allowed).toBe(false);
    expect(evaluateSandbox({ profile: strict, risk: 'credential_access' }).allowed).toBe(false);
  });

  it('blocks filesystem paths and network URLs outside allowlists', () => {
    const profile = { ...getSandboxProfile('workspace-write'), filesystemRoots: ['D:/Workspace'], networkAllowlist: ['https://api.example.com'] };
    expect(evaluateSandbox({ profile, risk: 'local_write', filePath: 'D:/Workspace/a.txt' }).allowed).toBe(true);
    expect(evaluateSandbox({ profile, risk: 'local_write', filePath: 'C:/Secrets/a.txt' }).allowed).toBe(false);
    expect(evaluateSandbox({ profile, risk: 'external_read', url: 'https://evil.example.com' }).allowed).toBe(false);
  });
});
