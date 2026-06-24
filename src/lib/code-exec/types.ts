import type { ArtifactManifest } from '../artifacts/types';

// Shape surfaced on a code.execute tool result (`details.codeRun`) and consumed
// by the chat CodeExecutionCard. Kept UI-friendly (camelCase, data URLs ready).

export type CodeRunStage = 'ran' | 'blocked' | 'no_python' | 'needs_package' | 'error';

export interface CodeRunFile {
  name: string;
  path: string;
  kind: string;
  mime: string;
  size: number;
  base64?: string;
  text?: string;
  textTruncated?: boolean;
  artifactManifest?: ArtifactManifest;
}

export interface CodeRunImage {
  name: string;
  path: string;
  mime: string;
  /** `data:<mime>;base64,...` ready for an <img src>. */
  dataUrl: string;
}

export interface CodeRunDetails {
  stage: CodeRunStage;
  language: 'python';
  code: string;
  label?: string;
  success?: boolean;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  allowNetwork?: boolean;
  /** Human-readable failure/blocker reason (not a raw traceback). */
  error?: string;
  installHint?: string | null;
  unknownPackages?: string[];
  files?: CodeRunFile[];
  images?: CodeRunImage[];
}
