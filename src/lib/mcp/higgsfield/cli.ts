// Higgsfield CLI runner. Executes the `higgsfield` CLI through the Tauri
// `shell_run` command. Auth (login session) is handled by the CLI itself — Larund
// never sees or stores Higgsfield tokens. All output is sanitized before it leaves
// this module: no auth tokens, bearer headers, or secret-looking values are ever
// returned to the model, UI, logs, or evidence.

export interface CliResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CliRunner = (command: string, opts?: { timeoutMs?: number }) => Promise<CliResult>;

const BIN = 'higgsfield';

let injectedRunner: CliRunner | null = null;

/** Test/seam hook: replace the underlying CLI runner. */
export function setHiggsfieldRunner(runner: CliRunner | null): void {
  injectedRunner = runner;
}

function quoteArg(arg: string): string {
  if (arg === '') return '""';
  // Safe for the cmd/sh quoting shell_run uses: wrap if it has whitespace/specials.
  return /^[A-Za-z0-9_./:=-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}

async function tauriRunner(command: string): Promise<CliResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  const r = await invoke<{ stdout: string; stderr: string; exit_code: number; success: boolean }>('shell_run', {
    command,
    workingDir: null,
  });
  return { success: r.success, stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exit_code ?? 0 };
}

function runner(): CliRunner {
  return injectedRunner ?? tauriRunner;
}

/** Run a `higgsfield <argv...>` command. argv values are quoted; never log raw output. */
export async function runHiggsfield(argv: string[], opts: { timeoutMs?: number } = {}): Promise<CliResult> {
  const command = [BIN, ...argv.map(quoteArg)].join(' ');
  try {
    const raw = await runner()(command, opts);
    return { ...raw, stdout: sanitizeCliOutput(raw.stdout), stderr: sanitizeCliOutput(raw.stderr) };
  } catch (e) {
    return { success: false, stdout: '', stderr: sanitizeCliOutput(String(e instanceof Error ? e.message : e)), exitCode: -1 };
  }
}

const SECRET_LINE = /(authorization|bearer|token|api[_-]?key|secret|password|refresh[_-]?token|access[_-]?token|cookie|session)\b/i;
const LONG_TOKEN = /\b[A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{8,}(?:\.[A-Za-z0-9_\-]{8,})?\b/g; // JWT-like
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi;

/** Remove token/secret-looking material from CLI output before it leaves the module. */
export function sanitizeCliOutput(text: string): string {
  if (!text) return '';
  return text
    .split(/\r?\n/)
    .map((line) => (SECRET_LINE.test(line) ? line.replace(/(:|=)\s*\S+/, '$1 [redacted]') : line))
    .join('\n')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(LONG_TOKEN, '[redacted]');
}

export type HiggsfieldCliState =
  | 'not_installed'
  | 'auth_required'
  | 'ready'
  | 'error';

export interface CliProbe {
  state: HiggsfieldCliState;
  version?: string;
  message: string;
}

/** Detect the CLI binary. */
export async function detectHiggsfieldCli(): Promise<{ installed: boolean; version?: string }> {
  const r = await runHiggsfield(['version']);
  if (r.success) return { installed: true, version: r.stdout.trim().split(/\r?\n/)[0] || undefined };
  // Some CLIs use --version.
  const alt = await runHiggsfield(['--version']);
  if (alt.success) return { installed: true, version: alt.stdout.trim().split(/\r?\n/)[0] || undefined };
  const text = `${r.stderr} ${alt.stderr}`.toLowerCase();
  if (/not (recognized|found)|no such file|command not found|enoent/.test(text)) return { installed: false };
  // Unknown failure but the binary seems present.
  return { installed: false };
}

/** Probe CLI install + auth without faking success. */
export async function probeHiggsfieldCli(): Promise<CliProbe> {
  const detect = await detectHiggsfieldCli();
  if (!detect.installed) {
    return { state: 'not_installed', message: 'Higgsfield CLI is not installed. Install it, then sign in.' };
  }
  const account = await runHiggsfield(['account', '--json']);
  if (account.success && account.stdout.trim()) {
    return { state: 'ready', version: detect.version, message: 'Higgsfield CLI is installed and signed in.' };
  }
  const text = `${account.stdout} ${account.stderr}`.toLowerCase();
  if (/login|log in|sign in|unauth|not authenticated|auth required|expired|401/.test(text) || !account.success) {
    return { state: 'auth_required', version: detect.version, message: 'Sign in to Higgsfield: run `higgsfield auth login` in a terminal.' };
  }
  return { state: 'error', version: detect.version, message: account.stderr || 'Higgsfield CLI returned an unexpected response.' };
}

export const HIGGSFIELD_INSTALL_HINTS = [
  'npm install -g @higgsfield/cli',
  'See https://higgsfield.ai/cli for platform installers',
];
