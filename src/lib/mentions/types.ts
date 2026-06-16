// Structured inline references ("mentions") shared by the Chat composer and the
// Automation editor. A mention looks like a chip in text but carries structured
// metadata so the agent runtime receives real context (skill body, connection
// status, MCP tools, memory content, workflow steps, file reference) rather than
// just a label.

export type MentionKind = 'skill' | 'connection' | 'mcp' | 'memory' | 'workflow' | 'file' | 'folder';

export interface ReferencedContext {
  id: string;
  kind: MentionKind;
  /** Short human label shown in the chip (e.g. "Google Sheets"). */
  label: string;
  /** Id of the underlying resource (skill id, provider id, server id, …). */
  refId: string;
  /** The text inserted into the prompt for this reference (e.g. "@Google Sheets"). */
  displayText: string;
  metadata?: Record<string, unknown>;
}

/** A pickable resource surfaced in the mention dropdown. */
export interface MentionResource {
  kind: MentionKind;
  refId: string;
  label: string;
  /** Optional secondary line (status, category, …). */
  detail?: string;
  /** True when the resource is usable right now (connected skill enabled, etc.). */
  available: boolean;
  metadata?: Record<string, unknown>;
}

export const MENTION_COLORS: Record<MentionKind, string> = {
  skill: '#A78BFA',     // purple
  connection: '#4A9EFF', // blue
  mcp: '#34BE78',        // green
  memory: '#F5A524',     // yellow
  workflow: '#FB923C',   // orange
  file: '#9CA3AF',       // gray
  folder: '#9CA3AF',     // gray
};

export const MENTION_TABS: Array<{ kind: MentionKind; label: string }> = [
  { kind: 'skill', label: 'Skills' },
  { kind: 'connection', label: 'Connections' },
  { kind: 'mcp', label: 'MCP' },
  { kind: 'memory', label: 'Memory' },
  { kind: 'workflow', label: 'Workflows' },
];

let counter = 0;
export function newReferenceId(): string {
  return `ref-${Date.now()}-${(counter++).toString(36)}`;
}

export function resourceToReference(r: MentionResource): ReferencedContext {
  return {
    id: newReferenceId(),
    kind: r.kind,
    label: r.label,
    refId: r.refId,
    displayText: `@${r.label}`,
    metadata: r.metadata,
  };
}
