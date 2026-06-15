// Workspace onboarding (Phase 2). A short questionnaire configures Larund for a
// user/workspace: it creates the workspace, seeds starter memory, recommends
// skills + connections, sets autonomy, and proposes sample tasks.
//
// `buildOnboardingPlan` is pure (no I/O) and fully testable. `applyOnboarding`
// persists the plan through the existing stores.

import type { CreateMemoryInput } from '../memory/types';
import { createMemory } from '../memory/store';
import { createWorkspace } from './store';
import type { AutonomyMode, CreateWorkspaceInput, Workspace, WorkspaceKind } from './types';

export type OnboardingPurpose =
  | 'development' | 'marketing' | 'operations' | 'admin'
  | 'client' | 'finance' | 'research' | 'custom';

export type GuardrailKey =
  | 'send_messages' | 'delete_files' | 'modify_production_code'
  | 'publish' | 'run_shell' | 'spend_money';

export interface OnboardingAnswers {
  userId: string;
  workspaceName: string;
  purpose: OnboardingPurpose;
  /** Connection provider ids the user uses (google-workspace, github, …). */
  tools: string[];
  /** What Larund should help with (free-form keys/phrases). */
  helpWith: string[];
  /** Actions that always require approval. */
  neverWithoutApproval: GuardrailKey[];
  /** Free-text style/preferences. */
  styleNotes?: string;
}

export interface OnboardingPlan {
  workspace: CreateWorkspaceInput;
  starterMemories: CreateMemoryInput[];
  recommendedSkills: string[];
  recommendedConnections: string[];
  suggestedRoleId?: string;
  sampleTasks: string[];
}

const PURPOSE_KIND: Record<OnboardingPurpose, WorkspaceKind> = {
  development: 'project', marketing: 'project', operations: 'project',
  admin: 'project', client: 'client', finance: 'project',
  research: 'project', custom: 'custom',
};

const PURPOSE_SKILLS: Record<OnboardingPurpose, string[]> = {
  development: ['vscode-project', 'github-maintainer', 'task-verification'],
  marketing: ['marketing-report', 'google-docs', 'browser-automation'],
  operations: ['file-organizer', 'local-office', 'google-workspace'],
  admin: ['file-organizer', 'google-workspace'],
  client: ['marketing-report', 'google-docs', 'notion-workspace'],
  finance: ['document-accounting', 'local-office', 'google-sheets'],
  research: ['browser-automation', 'document-accounting'],
  custom: ['task-verification'],
};

const PURPOSE_ROLE: Record<OnboardingPurpose, string> = {
  development: 'developer', marketing: 'marketing-strategist', operations: 'admin-assistant',
  admin: 'admin-assistant', client: 'client-success', finance: 'data-analyst',
  research: 'researcher', custom: 'document-operator',
};

const PURPOSE_SAMPLE_TASKS: Record<OnboardingPurpose, string[]> = {
  development: ['Fix the failing tests and summarize the git diff', 'Open a PR for the bugfix branch'],
  marketing: ['Compile this week’s marketing report', 'Draft a landing page audit'],
  operations: ['Organize the downloads folder by type', 'Create a status spreadsheet and verify it'],
  admin: ['Tidy the documents folder', 'Prepare a meeting summary doc'],
  client: ['Create the client weekly report and verify it', 'Draft a client follow-up email (do not send)'],
  finance: ['Read the invoices and build an accounting sheet', 'Reconcile the expense CSV'],
  research: ['Research top 3 competitors and summarize sources', 'Extract a table from a web page'],
  custom: ['Describe a task and I will plan it with the right tools'],
};

const GUARDRAIL_TEXT: Record<GuardrailKey, string> = {
  send_messages: 'Never send messages or emails without explicit approval.',
  delete_files: 'Never delete files without explicit approval.',
  modify_production_code: 'Never modify production code without explicit approval.',
  publish: 'Never post or publish anything without explicit approval.',
  run_shell: 'Always ask before running shell commands.',
  spend_money: 'Never take any action that spends money without explicit approval.',
};

const PRO_AUTONOMY: Record<OnboardingPurpose, AutonomyMode> = {
  development: 'semi', marketing: 'semi', operations: 'semi', admin: 'semi',
  client: 'manual', finance: 'manual', research: 'semi', custom: 'semi',
};

/** Pure: produce the full plan from questionnaire answers. */
export function buildOnboardingPlan(answers: OnboardingAnswers): OnboardingPlan {
  const purpose = answers.purpose;
  const kind = PURPOSE_KIND[purpose];
  // Guardrails imply more conservative autonomy.
  const autonomyMode: AutonomyMode = answers.neverWithoutApproval.length >= 4 ? 'manual' : PRO_AUTONOMY[purpose];

  const recommendedSkills = PURPOSE_SKILLS[purpose];
  const recommendedConnections = answers.tools;

  const starterMemories: CreateMemoryInput[] = [];

  // Purpose / project memory.
  starterMemories.push({
    userId: answers.userId,
    type: 'workspace',
    title: `Workspace purpose: ${answers.workspaceName}`,
    content: `This workspace is for ${purpose} work. Larund should help with: ${answers.helpWith.join(', ') || 'general tasks'}.`,
    tags: [purpose, 'workspace'],
    source: 'system',
    scope: 'workspace',
    confidence: 0.9,
  });

  // Guardrail memories (high-trust preferences).
  for (const g of answers.neverWithoutApproval) {
    starterMemories.push({
      userId: answers.userId,
      type: 'preference',
      title: `Guardrail: ${g.replace(/_/g, ' ')}`,
      content: GUARDRAIL_TEXT[g],
      tags: ['guardrail', 'approval'],
      source: 'user',
      scope: 'workspace',
      confidence: 1,
    });
  }

  // Style preference memory.
  if (answers.styleNotes?.trim()) {
    starterMemories.push({
      userId: answers.userId,
      type: 'preference',
      title: 'Style & preferences',
      content: answers.styleNotes.trim(),
      tags: ['style', 'preference'],
      source: 'user',
      scope: 'workspace',
      confidence: 0.9,
    });
  }

  return {
    workspace: {
      userId: answers.userId,
      name: answers.workspaceName,
      kind,
      autonomyMode,
      connectedProviderIds: recommendedConnections,
      enabledSkillIds: recommendedSkills,
    },
    starterMemories,
    recommendedSkills,
    recommendedConnections,
    suggestedRoleId: PURPOSE_ROLE[purpose],
    sampleTasks: PURPOSE_SAMPLE_TASKS[purpose],
  };
}

export interface OnboardingResult {
  workspace: Workspace;
  memoryCount: number;
  plan: OnboardingPlan;
}

/** Persist the plan: create the workspace and seed starter memory (scoped). */
export async function applyOnboarding(answers: OnboardingAnswers): Promise<OnboardingResult> {
  const plan = buildOnboardingPlan(answers);
  const workspace = await createWorkspace(plan.workspace);
  let memoryCount = 0;
  for (const m of plan.starterMemories) {
    await createMemory({ ...m, workspaceId: workspace.id });
    memoryCount++;
  }
  return { workspace, memoryCount, plan };
}
