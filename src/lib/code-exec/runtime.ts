// Thin TS bridge over the Rust isolated-Python commands. JSON in/out, no policy
// or approval logic here — that lives in tools/policy + tools/run.

import { invoke } from '@tauri-apps/api/core';
import type { ArtifactManifest } from '../artifacts/types';

export interface PythonRuntimeStatus {
  has_python: boolean;
  system_version?: string | null;
  venv_dir: string;
  venv_python: string;
  venv_ready: boolean;
  installed_packages: string[];
  install_hint?: string | null;
}

export interface CodeRunNewFile {
  name: string;
  path: string;
  kind: string;
  mime: string;
  size: number;
  base64?: string;
  text?: string;
  text_truncated?: boolean;
  artifact_manifest?: ArtifactManifest;
}

export interface CodeRunResult {
  success: boolean;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  run_id: string;
  run_dir: string;
  python: string;
  allow_network: boolean;
  input_files: string[];
  stdout: string;
  stderr: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  new_files: CodeRunNewFile[];
}

export interface CodeExecInput {
  src: string;
  name: string;
}

export interface RunCodeArgs {
  code: string;
  pythonPath?: string;
  workspaceRoot?: string;
  runId?: string;
  inputFiles?: CodeExecInput[];
  timeoutSecs?: number;
  allowNetwork?: boolean;
  maxOutputBytes?: number;
}

export async function pythonRuntimeStatus(): Promise<PythonRuntimeStatus> {
  const raw = await invoke<string>('python_runtime_status');
  return JSON.parse(raw) as PythonRuntimeStatus;
}

export async function ensurePythonRuntime(
  packages?: string[],
): Promise<{ ok: boolean; venv_python: string; installed_now: string[]; log: string[] }> {
  const raw = await invoke<string>('python_ensure_runtime', { packages: packages ?? null });
  return JSON.parse(raw) as { ok: boolean; venv_python: string; installed_now: string[]; log: string[] };
}

export async function installPythonPackage(pkg: string): Promise<string> {
  return invoke<string>('python_install_package', { package: pkg });
}

export async function runCode(args: RunCodeArgs): Promise<CodeRunResult> {
  const raw = await invoke<string>('code_execute', {
    req: {
      code: args.code,
      python_path: args.pythonPath ?? null,
      workspace_root: args.workspaceRoot ?? null,
      run_id: args.runId ?? null,
      input_files: args.inputFiles ?? null,
      timeout_secs: args.timeoutSecs ?? null,
      allow_network: args.allowNetwork ?? false,
      max_output_bytes: args.maxOutputBytes ?? null,
    },
  });
  return JSON.parse(raw) as CodeRunResult;
}
