// Orchestration for the `code.execute` tool: runtime check → static gate →
// import classification → venv provisioning → run → result shaping. Approval and
// audit are applied upstream in tools/run.ts; this assumes it is cleared to run.

import type { ControlAction, ControlToolResult } from '../control-system/types';
import type { ToolContext } from '../tools/types';
import { classifyImports } from './imports';
import { preflightStaticCheck } from './static-check';
import { basePackages } from './allowlist';
import { ensurePythonRuntime, pythonRuntimeStatus, runCode, type CodeExecInput, type CodeRunResult } from './runtime';
import type { CodeRunDetails, CodeRunFile, CodeRunImage } from './types';

type CodeExecuteAction = Extract<ControlAction, { action: 'code.execute' }>;
type InstallAction = Extract<ControlAction, { action: 'code.install_package' }>;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n… [levágva]` : s;
}

/** Pull the human-meaningful last line(s) out of a Python traceback. */
function summarizeTraceback(stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/).filter((l) => l.trim());
  const last = lines[lines.length - 1];
  if (last && /(Error|Exception|Warning)\b/.test(last)) return last.trim();
  return last?.trim() || 'A kód hibával állt le.';
}

function resolveInputFiles(action: CodeExecuteAction, ctx: ToolContext): CodeExecInput[] {
  const refs = action.input_refs ?? [];
  const out: CodeExecInput[] = [];
  for (const r of refs) {
    let path: string | undefined;
    const found = ctx.references?.find((ref) => ref.id === r);
    if (found?.path) path = found.path;
    else if (/[\\/]/.test(r) || /\.[a-z0-9]{1,6}$/i.test(r)) path = r;
    if (path) {
      const name = path.split(/[\\/]/).pop() ?? path;
      out.push({ src: path, name });
    }
  }
  return out;
}

function shapeResult(
  code: string,
  label: string | undefined,
  allowNetwork: boolean,
  res: CodeRunResult,
): ControlToolResult {
  const images: CodeRunImage[] = [];
  const files: CodeRunFile[] = [];
  for (const f of res.new_files) {
    files.push({
      name: f.name, path: f.path, kind: f.kind, mime: f.mime, size: f.size,
      base64: f.base64, text: f.text, textTruncated: f.text_truncated,
      artifactManifest: f.artifact_manifest,
    });
    if (f.kind === 'image' && f.base64) {
      images.push({ name: f.name, path: f.path, mime: f.mime, dataUrl: `data:${f.mime};base64,${f.base64}` });
    }
  }

  const details: CodeRunDetails = {
    stage: 'ran', language: 'python', code, label,
    success: res.success, exitCode: res.exit_code, timedOut: res.timed_out, durationMs: res.duration_ms,
    stdout: res.stdout, stderr: res.stderr, stdoutTruncated: res.stdout_truncated, stderrTruncated: res.stderr_truncated,
    allowNetwork, files, images,
  };
  if (!res.success) {
    details.error = res.timed_out
      ? 'A kód túllépte az időkorlátot, ezért leállítottuk.'
      : summarizeTraceback(res.stderr);
  }

  const lines: string[] = [];
  if (res.timed_out) lines.push('A kód időtúllépés miatt leállt (a megengedett időkorlátot elérte).');
  else lines.push(`A Python kód lefutott (exit ${res.exit_code ?? '—'}, ${(res.duration_ms / 1000).toFixed(1)}s).`);
  if (res.stdout.trim()) lines.push(`STDOUT:\n${truncate(res.stdout, 4000)}`);
  if (!res.success && res.stderr.trim()) lines.push(`HIBA:\n${truncate(res.stderr, 2000)}`);
  if (res.new_files.length) {
    lines.push(`Létrehozott fájlok: ${res.new_files.map((f) => `${f.name} (${f.kind})`).join(', ')}.`);
    // Full paths so the run is captured as an output in Run Monitor/Tasks and so a
    // follow-up can reference a chart by path (e.g. as an artifact image asset).
    lines.push(`Fájl elérési utak:\n${res.new_files.map((f) => f.path).join('\n')}`);
    if (images.length) {
      lines.push(`Kép(ek) (${images.map((i) => i.name).join(', ')}) inline megjelennek a chatben. Ha végső dokumentumba kell, add át a kép elérési útját a artifact.render_pdf/docx modell assets+image blokkjának — ne kézzel.`);
    }
    const data = res.new_files.filter((f) => f.kind === 'csv' || f.kind === 'json');
    if (data.length) {
      lines.push(`Strukturált kimenet (${data.map((f) => f.name).join(', ')}): ha a cél formázott Excel-riport, az adatot add át a sheet.write / sheet.format_range Rust-toolnak — NE a Python írja a végső .xlsx-et.`);
    }
  }

  return {
    success: res.success,
    output: lines.join('\n\n'),
    error: res.success ? undefined : (details.error ?? 'code_run_failed'),
    details: { codeRun: details },
  };
}

export async function executeCode(action: CodeExecuteAction, ctx: ToolContext): Promise<ControlToolResult> {
  const code = String(action.code ?? '');
  const label = action.label;
  const allowNetwork = Boolean(action.allow_network);
  if (!code.trim()) return { success: false, output: '', error: 'empty_code' };

  // 1. Is there a usable Python at all?
  let status;
  try {
    status = await pythonRuntimeStatus();
  } catch (e) {
    return { success: false, output: '', error: `python_runtime_unavailable: ${String(e)}` };
  }
  if (!status.has_python) {
    const details: CodeRunDetails = {
      stage: 'no_python', language: 'python', code, label,
      error: 'A gépen nincs telepítve Python 3.', installHint: status.install_hint ?? undefined,
    };
    return {
      success: false,
      output: `Nem tudtam kódot futtatni: a gépen nincs elérhető Python 3. ${status.install_hint ?? 'Telepítsd a https://www.python.org/downloads/ oldalról, majd próbáld újra.'}`,
      error: 'python_not_found',
      details: { codeRun: details },
    };
  }

  const inputFiles = resolveInputFiles(action, ctx);
  const inputNames = inputFiles.map((f) => f.name);

  // 2. Fast static gate (Rust re-checks authoritatively).
  const pre = preflightStaticCheck(code, { allowNetwork, inputNames });
  if (!pre.ok) {
    const details: CodeRunDetails = { stage: 'blocked', language: 'python', code, label, error: pre.reason };
    return {
      success: false,
      output: `A kódot biztonsági okból nem futtattam: ${pre.reason}`,
      error: 'blocked_unsafe_code',
      details: { codeRun: details },
    };
  }

  // 3. Imports: stdlib is free, allowlist auto-provisions, anything else needs approval.
  const imp = classifyImports(code);
  if (imp.unknown.length) {
    const details: CodeRunDetails = {
      stage: 'needs_package', language: 'python', code, label, unknownPackages: imp.unknown,
      error: `Engedélyezett listán kívüli csomag(ok): ${imp.unknown.join(', ')}.`,
    };
    return {
      success: false,
      output: `A kódhoz nem engedélyezett csomag kell: ${imp.unknown.join(', ')}. Kérj jóváhagyást a telepítésre a code.install_package eszközzel (csomagonként), VAGY írd át a kódot a már engedélyezett könyvtárakkal (pandas, numpy, matplotlib, openpyxl, python-docx, python-pptx, PyMuPDF).`,
      error: 'package_not_allowed',
      details: { codeRun: details },
    };
  }

  // 4. Provision the venv + any missing allowlisted packages (pre-approved set).
  const installed = new Set(status.installed_packages.map((p) => p.toLowerCase()));
  const missing = imp.allowlist.filter((e) => !installed.has(e.dist)).map((e) => e.pip);
  const ensurePkgs = Array.from(new Set([...basePackages(), ...missing]));
  try {
    const ens = await ensurePythonRuntime(ensurePkgs);
    if (ens.venv_python) status.venv_python = ens.venv_python;
  } catch (e) {
    const details: CodeRunDetails = { stage: 'error', language: 'python', code, label, error: String(e) };
    return {
      success: false,
      output: `A Python környezet előkészítése nem sikerült: ${String(e)}`,
      error: 'venv_setup_failed',
      details: { codeRun: details },
    };
  }

  // 5. Run it.
  let res: CodeRunResult;
  try {
    res = await runCode({
      code,
      pythonPath: status.venv_python,
      workspaceRoot: ctx.workspaceRoot,
      inputFiles,
      allowNetwork,
      timeoutSecs: action.timeout_secs,
    });
  } catch (e) {
    const details: CodeRunDetails = { stage: 'error', language: 'python', code, label, error: String(e) };
    return {
      success: false,
      output: `A kódfuttatás meghiúsult: ${String(e)}`,
      error: 'code_execute_failed',
      details: { codeRun: details },
    };
  }

  return shapeResult(code, label, allowNetwork, res);
}

export async function installPackageAction(action: InstallAction): Promise<ControlToolResult> {
  const pkg = String(action.package ?? '').trim();
  if (!pkg) return { success: false, output: '', error: 'missing_package' };
  try {
    const { installPythonPackage } = await import('./runtime');
    const raw = await installPythonPackage(pkg);
    return { success: true, output: `Telepítve: ${pkg}. ${raw}` };
  } catch (e) {
    return { success: false, output: '', error: `pip_install_failed: ${String(e)}` };
  }
}
