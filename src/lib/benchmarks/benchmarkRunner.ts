// Benchmark runner — a simple, extensible static analyzer. It does NOT call the
// model; it scores how *ready* the operator is to attempt each benchmark by checking
// the benchmark's required capabilities and allowed/forbidden tools against the real
// implementation surface (the capability matrix + the parser allow-list + the
// no-mouse legacy guard). This makes the audit reproducible and keeps the report in
// sync with code. A live, model-in-the-loop runner can be layered on later using the
// same BenchmarkDefinition catalog without changing these definitions.

import { ALLOWED_ACTIONS, isLegacyVisualActionName } from '../control-system/parser';
import { decide, DEFAULT_POLICY } from '../tools/policy';
import type { ControlAction } from '../control-system/types';
import type { BenchmarkDefinition } from './benchmarkTypes';
import { BENCHMARK_CATALOG } from './benchmarkCatalog';
import { allCapabilities, getCapability, type CapabilityId, type CapabilityStatus } from './capabilities';

export type ReadinessStatus = 'ready' | 'partial' | 'blocked';

export interface BenchmarkReadiness {
  id: string;
  title: string;
  status: ReadinessStatus;
  /** Required capabilities that are not 'available'. */
  partialCapabilities: Array<{ id: CapabilityId; status: CapabilityStatus; missingWork?: string }>;
  missingCapabilities: CapabilityId[];
  /** Allowed tools that are not implemented in the parser allow-list (a real bug). */
  unimplementedAllowedTools: string[];
  /** Forbidden tools that would actually run un-gated (a safety bug). */
  unenforcedForbiddenTools: string[];
  notes: string[];
}

/** True when a tool name would be rejected outright by the runtime (not allowed, or legacy). */
function isToolRejected(name: string): boolean {
  return isLegacyVisualActionName(name) || !ALLOWED_ACTIONS.has(name as never);
}

/**
 * A forbidden tool is safely enforced if EITHER the runtime rejects it outright
 * (mouse/visual/unknown), OR it is a real action whose risk is approval-gated under
 * the default policy (e.g. file.delete is destructive → "ask"). It is only a real
 * safety gap when a forbidden real action would auto-run.
 */
function isForbiddenToolEnforced(name: string): boolean {
  if (isToolRejected(name)) return true;
  const { decision } = decide({ action: name } as ControlAction, DEFAULT_POLICY);
  return decision !== 'auto';
}

export function evaluateBenchmark(def: BenchmarkDefinition): BenchmarkReadiness {
  const partialCapabilities: BenchmarkReadiness['partialCapabilities'] = [];
  const missingCapabilities: CapabilityId[] = [];
  for (const capId of def.requiredCapabilities) {
    const cap = getCapability(capId);
    const status: CapabilityStatus = cap.status;
    if (status === 'missing') missingCapabilities.push(capId);
    else if (status === 'partial') partialCapabilities.push({ id: capId, status, missingWork: cap.missingWork });
  }

  // Allowed tools must actually be implemented (present in the parser allow-list and
  // not a legacy visual action).
  const unimplementedAllowedTools = def.allowedTools.filter(
    (t) => isLegacyVisualActionName(t) || !ALLOWED_ACTIONS.has(t),
  );

  // Forbidden tools must be enforced — rejected outright or approval-gated.
  const unenforcedForbiddenTools = def.forbiddenTools.filter((t) => !isForbiddenToolEnforced(t));

  const notes: string[] = [];
  if (partialCapabilities.length) {
    notes.push(`Partial capabilities: ${partialCapabilities.map((c) => c.id).join(', ')}.`);
  }
  if (missingCapabilities.length) notes.push(`Missing capabilities: ${missingCapabilities.join(', ')}.`);
  if (unimplementedAllowedTools.length) notes.push(`Allowed tools not implemented: ${unimplementedAllowedTools.join(', ')}.`);
  if (unenforcedForbiddenTools.length) notes.push(`Forbidden tools NOT enforced: ${unenforcedForbiddenTools.join(', ')}.`);

  let status: ReadinessStatus = 'ready';
  if (missingCapabilities.length || unimplementedAllowedTools.length || unenforcedForbiddenTools.length) {
    status = 'blocked';
  } else if (partialCapabilities.length) {
    status = 'partial';
  }

  return {
    id: def.id,
    title: def.title,
    status,
    partialCapabilities,
    missingCapabilities,
    unimplementedAllowedTools,
    unenforcedForbiddenTools,
    notes,
  };
}

export interface BenchmarkSuiteResult {
  results: BenchmarkReadiness[];
  totals: { total: number; ready: number; partial: number; blocked: number };
}

export function evaluateSuite(catalog: BenchmarkDefinition[] = BENCHMARK_CATALOG): BenchmarkSuiteResult {
  const results = catalog.map(evaluateBenchmark);
  const totals = {
    total: results.length,
    ready: results.filter((r) => r.status === 'ready').length,
    partial: results.filter((r) => r.status === 'partial').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
  };
  return { results, totals };
}

/** Render a compact markdown report of the suite + capability matrix. */
export function renderReadinessMarkdown(suite: BenchmarkSuiteResult = evaluateSuite()): string {
  const { results, totals } = suite;
  const badge = (s: ReadinessStatus) => (s === 'ready' ? 'READY' : s === 'partial' ? 'PARTIAL' : 'BLOCKED');

  const lines: string[] = [];
  lines.push('## Readiness summary');
  lines.push(`- Total: ${totals.total}`);
  lines.push(`- Ready: ${totals.ready}`);
  lines.push(`- Partial: ${totals.partial}`);
  lines.push(`- Blocked: ${totals.blocked}`);
  lines.push('');
  lines.push('## Capability matrix');
  lines.push('| Capability | Status | Evidence | Missing work |');
  lines.push('| ---------- | ------ | -------- | ------------ |');
  for (const c of allCapabilities()) {
    lines.push(`| ${c.label} | ${c.status} | ${c.evidence} | ${c.missingWork ?? '—'} |`);
  }
  lines.push('');
  lines.push('## Benchmark readiness');
  lines.push('| ID | Title | Status | Notes |');
  lines.push('| -- | ----- | ------ | ----- |');
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.title} | ${badge(r.status)} | ${r.notes.join(' ') || '—'} |`);
  }
  return lines.join('\n');
}
