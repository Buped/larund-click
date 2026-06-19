import { describe, expect, it } from 'vitest';
import { ALLOWED_ACTIONS, isLegacyVisualActionName } from '../../control-system/parser';
import { decide, DEFAULT_POLICY } from '../../tools/policy';
import type { ControlAction } from '../../control-system/types';
import { BENCHMARK_CATALOG, getBenchmark } from '../benchmarkCatalog';
import { CAPABILITY_MATRIX, allCapabilities } from '../capabilities';
import { UNIVERSAL_FORBIDDEN_TOOLS } from '../benchmarkTypes';
import { evaluateBenchmark, evaluateSuite, renderReadinessMarkdown } from '../benchmarkRunner';
import { P0_SMOKE_SET, getP0Case, p0Benchmarks } from '../p0Smoke';

describe('benchmark catalog integrity', () => {
  it('defines all 18 reference benchmarks with unique ids', () => {
    expect(BENCHMARK_CATALOG).toHaveLength(18);
    const ids = BENCHMARK_CATALOG.map((b) => b.id);
    expect(new Set(ids).size).toBe(18);
  });

  it('every benchmark has the required structured fields', () => {
    for (const b of BENCHMARK_CATALOG) {
      expect(b.userPrompt.length).toBeGreaterThan(10);
      expect(b.requiredCapabilities.length).toBeGreaterThan(0);
      expect(b.allowedTools.length).toBeGreaterThan(0);
      expect(b.expectedArtifacts.length).toBeGreaterThan(0);
      expect(b.verificationCriteria.length).toBeGreaterThan(0);
      expect(b.safetyRequirements.length).toBeGreaterThan(0);
      expect(b.knownLimitations).toBeDefined();
      // The 0–3 rubric is fully populated.
      expect(b.scoring.zero && b.scoring.one && b.scoring.two && b.scoring.three).toBeTruthy();
    }
  });

  it('getBenchmark resolves by id', () => {
    expect(getBenchmark('B01-invoice-download')?.title).toMatch(/Invoice download/);
    expect(getBenchmark('nope')).toBeUndefined();
  });
});

describe('benchmark / implementation consistency', () => {
  it('every allowed tool is a real, implemented control action (no phantom tools)', () => {
    for (const b of BENCHMARK_CATALOG) {
      for (const tool of b.allowedTools) {
        expect(ALLOWED_ACTIONS.has(tool), `${b.id}: ${tool} must be in the parser allow-list`).toBe(true);
        expect(isLegacyVisualActionName(tool), `${b.id}: ${tool} must not be a legacy visual action`).toBe(false);
      }
    }
  });

  it('every forbidden tool is enforced — rejected outright or approval-gated', () => {
    for (const b of BENCHMARK_CATALOG) {
      for (const tool of b.forbiddenTools) {
        const rejected = isLegacyVisualActionName(tool) || !ALLOWED_ACTIONS.has(tool as never);
        // A real action that is contextually forbidden (e.g. file.delete) must at least
        // be approval-gated, never auto-run.
        const gated = !rejected && decide({ action: tool } as ControlAction, DEFAULT_POLICY).decision !== 'auto';
        expect(rejected || gated, `${b.id}: forbidden tool ${tool} must be rejected or approval-gated`).toBe(true);
      }
    }
  });

  it('the universal mouse/visual forbidden tools are all rejected', () => {
    for (const tool of UNIVERSAL_FORBIDDEN_TOOLS) {
      expect(isLegacyVisualActionName(tool) || !ALLOWED_ACTIONS.has(tool as never)).toBe(true);
    }
  });

  it('every required capability id exists in the matrix', () => {
    for (const b of BENCHMARK_CATALOG) {
      for (const cap of b.requiredCapabilities) {
        expect(CAPABILITY_MATRIX[cap], `${b.id}: unknown capability ${cap}`).toBeDefined();
      }
    }
  });

  it('every capability is backed by valid control actions or named runtime features', () => {
    for (const cap of allCapabilities()) {
      expect(cap.backedBy.length).toBeGreaterThan(0);
      expect(cap.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('benchmark readiness', () => {
  it('scores every benchmark and reports no blocked tasks (capabilities + tools wired)', () => {
    const suite = evaluateSuite();
    expect(suite.totals.total).toBe(18);
    const blocked = suite.results.filter((r) => r.status === 'blocked');
    expect(blocked, `blocked: ${blocked.map((b) => `${b.id} (${b.notes.join(' ')})`).join('; ')}`).toHaveLength(0);
    expect(suite.totals.ready + suite.totals.partial).toBe(18);
  });

  it('flags an unimplemented allowed tool as blocked', () => {
    const broken = evaluateBenchmark({
      ...BENCHMARK_CATALOG[0],
      allowedTools: [...BENCHMARK_CATALOG[0].allowedTools, 'mouse.click' as never],
    });
    expect(broken.status).toBe('blocked');
    expect(broken.unimplementedAllowedTools).toContain('mouse.click');
  });

  it('renders a markdown report with the capability matrix and benchmark table', () => {
    const md = renderReadinessMarkdown();
    expect(md).toContain('## Capability matrix');
    expect(md).toContain('## Benchmark readiness');
    expect(md).toContain('B01-invoice-download');
  });
});

describe('P0 smoke set', () => {
  it('defines exactly the 5 P0 cases, each backed by a real benchmark', () => {
    expect(P0_SMOKE_SET).toHaveLength(5);
    expect(P0_SMOKE_SET.map((c) => c.id)).toEqual(['P0-1', 'P0-2', 'P0-3', 'P0-4', 'P0-5']);
    expect(() => p0Benchmarks()).not.toThrow();
    expect(p0Benchmarks()).toHaveLength(5);
  });

  it('every P0 case has a fixture, prompt, expected output, verification and steps', () => {
    for (const c of P0_SMOKE_SET) {
      expect(c.fixture.location.length).toBeGreaterThan(0);
      expect(c.prompt.length).toBeGreaterThan(10);
      expect(c.expectedOutput.length).toBeGreaterThan(0);
      expect(c.verification.length).toBeGreaterThan(0);
      expect(c.manualSteps.length).toBeGreaterThan(0);
    }
  });

  it('getP0Case resolves by id', () => {
    expect(getP0Case('P0-4')?.benchmarkId).toBe('B01-invoice-download');
    expect(getP0Case('nope')).toBeUndefined();
  });
});
