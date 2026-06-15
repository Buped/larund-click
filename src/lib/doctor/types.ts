// Larund Doctor — diagnostics for the no-mouse coworker core. Pure check logic
// lives in checks.ts; the live gatherer wires real facts (tool catalog, skills,
// stores) into those checks.

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Actionable hint shown when status is warn/fail. */
  remedy?: string;
}

export interface DoctorReport {
  ranAt: string;
  checks: DoctorCheck[];
  summary: { pass: number; warn: number; fail: number };
}

/** Facts the pure checks operate on, so they can be unit-tested in isolation. */
export interface DoctorFacts {
  toolNames: string[];
  bundledSkillCount: number;
  skillLoadErrors: string[];
  googleWorkspaceStatus: 'configured' | 'missing_auth' | 'scaffold' | 'unknown';
  browserCdpAvailable: boolean | 'unknown';
  workspaceStoreOk: boolean;
  memoryStoreOk: boolean;
  taskStoreOk: boolean;
}
