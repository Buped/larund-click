// Pure helpers that translate the agent loop's AgentStep stream into the
// persistent EvidenceEntry / TaskStatus / OutputRef model. Kept side-effect-free
// so the mapping is fully unit-testable without the store or the loop.

import type { AddEvidenceInput, EvidenceKind, OutputRef, OutputRefKind, TaskStatus } from './types';

/** Minimal shape of an AgentStep we care about (decoupled from the loop type). */
export interface StepLike {
  type: string;
  tool?: string;
  input?: string;
  output?: string;
  error?: string;
  risk?: string;
}

/** Map an AgentStep.type to an EvidenceEntry.kind. */
export function evidenceKindForStep(step: StepLike): EvidenceKind | null {
  switch (step.type) {
    case 'thinking':
    case 'narration':
      return 'thinking';
    case 'plan':
    case 'checklist':
      return 'plan';
    case 'tool_call':
      return 'tool_call';
    case 'tool_result':
      return classifyResult(step);
    case 'approval':
      return 'approval';
    case 'verification':
      return 'verification';
    case 'handoff':
    case 'blocked':
      return 'manual_handoff';
    case 'error':
      return 'error';
    case 'complete':
      return 'complete';
    default:
      // Unknown UI-only steps are not persisted as evidence.
      return null;
  }
}

function classifyResult(step: StepLike): EvidenceKind {
  const tool = step.tool ?? '';
  if (/^connection\./.test(tool) || tool === 'connection.call') return 'connection_output';
  if (/read|list|tree|exists|get_state|assert|metadata|to_json/.test(tool)) return 'read_back';
  if (/write|mkdir|move|copy|append|export|download|upload|paste/.test(tool)) return 'file_output';
  return 'tool_result';
}

const TRUNCATE = 2000;

/** Build an AddEvidenceInput from a step (returns null for non-evidence steps). */
export function stepToEvidence(
  step: StepLike,
  base: { taskRunId: string; userId: string; workspaceId?: string },
): AddEvidenceInput | null {
  const kind = evidenceKindForStep(step);
  if (!kind) return null;
  const success = step.type === 'error' ? false : step.error ? false : step.type === 'tool_result' ? true : undefined;
  const title = titleFor(kind, step);
  const content = truncate(step.output ?? step.error ?? step.input ?? '', TRUNCATE);
  return {
    taskRunId: base.taskRunId,
    userId: base.userId,
    workspaceId: base.workspaceId,
    kind,
    title,
    content,
    tool: step.tool,
    risk: step.risk,
    success,
    artifactUri: detectArtifactUri(step),
  };
}

function titleFor(kind: EvidenceKind, step: StepLike): string {
  const tool = step.tool ? ` ${step.tool}` : '';
  switch (kind) {
    case 'tool_call':
      return `Called${tool}`;
    case 'thinking':
      return 'Thinking';
    case 'plan':
      return 'Plan';
    case 'complete':
      return 'Completed';
    case 'read_back':
      return `Read-back${tool}`;
    case 'file_output':
      return `Output${tool}`;
    case 'connection_output':
      return `Connection${tool}`;
    case 'verification':
      return step.error ? 'Verification failed' : 'Verification passed';
    case 'approval':
      return `Approval${tool}`;
    case 'manual_handoff':
      return 'Manual handoff required';
    case 'error':
      return `Error${tool}`;
    default:
      return `Step${tool}`;
  }
}

/** Best-effort detection of an artifact URI/path from a step's text. */
function detectArtifactUri(step: StepLike): string | undefined {
  const text = `${step.output ?? ''}`;
  const url = text.match(/https?:\/\/[^\s"')]+/)?.[0];
  if (url) return url;
  // Windows drive paths (back- or forward-slash) or absolute POSIX file paths.
  const filePath = text.match(/[A-Za-z]:[\\/][^\s"']+|\/[^\s"']+\.[a-z0-9]{1,5}/i)?.[0];
  return filePath;
}

/**
 * Derive an OutputRef from a successful step that produced something the user can
 * open. Returns null when nothing referenceable was produced.
 */
export function stepToOutputRef(step: StepLike): Omit<OutputRef, 'id'> | null {
  if (step.type !== 'tool_result' || step.error) return null;
  const uri = detectArtifactUri(step);
  if (!uri) return null;
  const kind = outputKindFor(step.tool ?? '', uri);
  return { kind, label: deriveLabel(uri), uri };
}

function outputKindFor(tool: string, uri: string): OutputRefKind {
  if (/docs\.google\.com\/document/.test(uri)) return 'google_doc';
  if (/docs\.google\.com\/spreadsheets/.test(uri) || /sheets/.test(tool)) {
    return uri.startsWith('http') ? 'google_sheet' : 'local_file';
  }
  if (/github\.com\/.+\/pull\//.test(uri)) return 'github_pr';
  if (/github\.com\/.+\/issues\//.test(uri)) return 'github_issue';
  if (uri.startsWith('http')) return 'url';
  if (/[A-Za-z]:\\|^\//.test(uri)) return 'local_file';
  return 'other';
}

function deriveLabel(uri: string): string {
  if (uri.startsWith('http')) return uri.replace(/^https?:\/\//, '').slice(0, 60);
  return uri.split(/[\\/]/).pop() ?? uri;
}

/** Map a manual blocker kind to the corresponding blocked status. */
export function blockedStatusFor(blocker: 'login' | 'captcha' | 'permission' | 'input'): TaskStatus {
  switch (blocker) {
    case 'login':
      return 'needs_login';
    case 'input':
      return 'needs_input';
    case 'captcha':
    case 'permission':
    default:
      return 'blocked';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
