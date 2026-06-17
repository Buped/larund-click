import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const syncScript = resolve(process.cwd(), 'scripts/sync-env.ts');
const auditScript = resolve(process.cwd(), 'scripts/env-audit.ts');

function run(script: string, cwd: string, args: string[] = []): { out: string; err: string } {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { out: r.stdout ?? '', err: r.stderr ?? '' };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'larund-env-'));
}

describe('env sync script', () => {
  it('.gitignore keeps local env files out of git', () => {
    const gitignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.env.local');
    expect(gitignore).toContain('.env.*.local');
    expect(gitignore).toContain('!.env.example');
  });

  it('writes app-level credentials only — never user tokens or DEV_* by default', () => {
    const cwd = tempDir();
    try {
      const { out } = run(syncScript, cwd);
      const env = readFileSync(join(cwd, '.env'), 'utf8');
      expect(out).toContain('added keys');
      // App-level OAuth client credentials are written.
      expect(env).toContain('GITHUB_CLIENT_ID=');
      expect(env).toContain('GOOGLE_CLIENT_ID=');
      // One shared loopback redirect, no per-provider redirect keys.
      expect(env).toContain('LARUND_OAUTH_CALLBACK_BASE=http://localhost:14200');
      expect(env).not.toMatch(/^GOOGLE_REDIRECT_URI=/m);
      expect(env).not.toMatch(/^X_REDIRECT_URI=/m);
      expect(env).toContain('LARUND_AUTH_EXCHANGE_MODE=local_dev');
      // User tokens are NEVER written.
      expect(env).not.toMatch(/^GITHUB_TOKEN=/m);
      expect(env).not.toContain('GOOGLE_WORKSPACE_ACCESS_TOKEN=');
      expect(env).not.toContain('X_WRITE_ACCESS_TOKEN=');
      expect(env).not.toContain('SLACK_BOT_TOKEN=');
      // DEV_* shortcuts are not written without the flag.
      expect(env).not.toContain('DEV_GITHUB_TOKEN=');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('adds DEV_* shortcut keys only with --include-dev-shortcuts', () => {
    const cwd = tempDir();
    try {
      run(syncScript, cwd, ['--include-dev-shortcuts']);
      const env = readFileSync(join(cwd, '.env'), 'utf8');
      expect(env).toContain('DEV_GITHUB_TOKEN=');
      expect(env).toContain('DEV_X_BEARER_TOKEN=');
      // Still no user tokens (a bare GITHUB_TOKEN line, not the DEV_ shortcut).
      expect(env).not.toMatch(/^GITHUB_TOKEN=/m);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves existing values, removes duplicates, and warns about legacy user tokens', () => {
    const cwd = tempDir();
    try {
      writeFileSync(join(cwd, '.env'), 'GITHUB_CLIENT_ID=keep-me\nGITHUB_CLIENT_ID=dup\nGITHUB_TOKEN=ghp_legacy\nCUSTOM_KEY=custom\n');
      const { out, err } = run(syncScript, cwd);
      const env = readFileSync(join(cwd, '.env'), 'utf8');
      expect(env).toContain('GITHUB_CLIENT_ID=keep-me');
      expect(env).not.toContain('GITHUB_CLIENT_ID=dup');
      expect(env).toContain('CUSTOM_KEY=custom');
      // Legacy user token preserved (never auto-deleted) but flagged.
      expect(env).toContain('GITHUB_TOKEN=ghp_legacy');
      expect(out).toContain('duplicate keys removed: GITHUB_CLIENT_ID');
      expect(err).toContain('legacy user-token keys present');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('env:audit flags legacy user-token keys and reports developer setup', () => {
    const cwd = tempDir();
    try {
      writeFileSync(join(cwd, '.env'), 'GOOGLE_CLIENT_ID=id\nGOOGLE_CLIENT_SECRET=sec\nGOOGLE_REDIRECT_URI=http://x\nX_WRITE_ACCESS_TOKEN=secret-token\n');
      const { out } = run(auditScript, cwd);
      expect(out).toContain('Google Workspace');
      expect(out).toContain('developer setup missing');
      expect(out).toContain('X_WRITE_ACCESS_TOKEN');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
