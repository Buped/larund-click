// Larund Operator Benchmark — type definitions. A benchmark is a structured,
// repeatable description of a real customer task: the prompt, the capabilities and
// tools it is allowed (and forbidden) to use, the artifacts it must produce, how to
// verify success, the safety it must respect, and the 0–3 scoring rubric.
//
// These definitions are deliberately data, not code: the benchmarkRunner scores
// readiness against the capability matrix, and the same catalog can later drive a
// live (model-in-the-loop) run without changing the definitions.

import type { ControlActionName } from '../control-system/types';
import type { CapabilityId } from './capabilities';

export type BenchmarkCategory =
  | 'accounting'
  | 'email'
  | 'onboarding'
  | 'sales'
  | 'ecommerce'
  | 'content'
  | 'crm'
  | 'reporting'
  | 'file_management'
  | 'automation'
  | 'forms';

export interface ExpectedArtifact {
  /** Where the output should land (folder / file / web surface). */
  location: string;
  /** What kind of artifact (xlsx, csv, docx, txt, html, folder tree, draft, log…). */
  kind: string;
  /** Human description of the artifact and its required shape. */
  description: string;
}

/** The 0–3 rubric, instantiated per benchmark with concrete expectations. */
export interface ScoringRubric {
  /** 0 — could not start / did the wrong thing. */
  zero: string;
  /** 1 — partially done, much manual help. */
  one: string;
  /** 2 — done with a minor mistake or little help. */
  two: string;
  /** 3 — done autonomously, safely, with read-back verification. */
  three: string;
}

export interface BenchmarkDefinition {
  id: string;
  title: string;
  /** The exact end-user prompt (kept in the original language where it matters). */
  userPrompt: string;
  category: BenchmarkCategory;
  /** Capabilities that MUST be available for this benchmark to pass. */
  requiredCapabilities: CapabilityId[];
  /** Tools the run may use. */
  allowedTools: ControlActionName[];
  /** Tools the run must never use (always includes mouse/visual families implicitly). */
  forbiddenTools: string[];
  /** How to set up a safe local fixture / sandbox (no real customer sites). */
  setup: string;
  expectedArtifacts: ExpectedArtifact[];
  /** Concrete, checkable success criteria. */
  verificationCriteria: string[];
  /** Safety the run must honour (approvals, no-delete, no-send, no-publish…). */
  safetyRequirements: string[];
  scoring: ScoringRubric;
  knownLimitations: string[];
}

/** Universal forbidden tools: the retired mouse / cursor / visual / SOC families. */
export const UNIVERSAL_FORBIDDEN_TOOLS: string[] = [
  'mouse.click', 'mouse.move', 'mouse.drag', 'mouse_click',
  'cursor.move', 'visual.click', 'soc.visual',
  'click_visual_target', 'ground_visual_target', 'desktop_click_point',
  'screenshot_click', 'ocr_click', 'grid_click',
];
