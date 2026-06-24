// User-configurable code-execution approval policy. Exposed on the
// Connections/Settings surface. The conservative default ("always ask") is
// deliberate: running code is process_exec and should not be silent unless the
// user opts into it.

export type CodeExecApprovalMode =
  /** Every code.execute asks for approval (default). */
  | 'always_ask'
  /** Read-only analysis with no network may run without approval; network and
   *  package installs still always ask. */
  | 'auto_local';

const KEY = 'larund.codeExec.approvalMode';

export function getCodeExecApprovalMode(): CodeExecApprovalMode {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'auto_local' ? 'auto_local' : 'always_ask';
  } catch {
    return 'always_ask';
  }
}

export function setCodeExecApprovalMode(mode: CodeExecApprovalMode): void {
  try {
    globalThis.localStorage?.setItem(KEY, mode);
  } catch {
    /* non-fatal: setting is a preference, not load-bearing */
  }
}

/**
 * Whether a given code.execute call must be approved, given the user's mode.
 * Network always forces approval regardless of mode.
 */
export function codeExecRequiresApproval(args: { allowNetwork?: boolean; mode?: CodeExecApprovalMode }): boolean {
  if (args.allowNetwork) return true;
  const mode = args.mode ?? getCodeExecApprovalMode();
  return mode !== 'auto_local';
}
