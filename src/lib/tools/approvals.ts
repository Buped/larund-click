import type { ApprovalOutcome, ApprovalRequest, ApprovalService } from './types';
import { createApprovalRequest, resolveApprovalRequest } from '../approvals/store';

let approvalCounter = 0;
function newApprovalId(): string {
  approvalCounter += 1;
  return `appr-${Date.now()}-${approvalCounter}`;
}

/**
 * Result of the UI approval prompt. `steer` means the user picked "Other" and
 * typed an instruction (`feedback`) for what to do instead — the loop re-plans.
 */
export interface ApprovalPromptResult {
  decision: 'allow_once' | 'allow_always' | 'deny' | 'steer';
  feedback?: string;
}

export type ApprovalPrompt = (req: ApprovalRequest) => Promise<ApprovalPromptResult>;

export interface PersistentApprovalContext {
  userId: string;
  workspaceId?: string;
  taskRunId?: string;
  automationRunId?: string;
}

/**
 * Approval service backed by a UI prompt callback. When no prompt is wired
 * (e.g. headless tests), the `defaultDecision` is used.
 */
export class PromptApprovalService implements ApprovalService {
  private alwaysAllowed = new Set<string>();

  constructor(
    private prompt?: ApprovalPrompt,
    private defaultDecision: 'allow_once' | 'deny' = 'deny',
    private persistentContext?: PersistentApprovalContext,
  ) {}

  grantAlways(actionName: string): void {
    this.alwaysAllowed.add(actionName);
  }

  async request(partial: Omit<ApprovalRequest, 'id' | 'createdAt'>): Promise<ApprovalOutcome> {
    if (this.alwaysAllowed.has(partial.action.action)) return { approved: true };
    const req: ApprovalRequest = { ...partial, id: newApprovalId(), createdAt: Date.now() };
    let persistedId: string | undefined;
    if (this.persistentContext) {
      try {
        const persisted = await createApprovalRequest({
          ...this.persistentContext,
          actionName: partial.action.action,
          risk: partial.risk,
          reason: partial.reason,
          argsSummary: partial.argsSummary,
          metadata: { inlineApprovalId: req.id, preview: partial.preview },
        });
        persistedId = persisted.id;
      } catch {
        /* approval inbox is best-effort; inline prompt remains source of truth */
      }
    }
    const result: ApprovalPromptResult = this.prompt
      ? await this.prompt(req)
      : { decision: this.defaultDecision };
    const { decision } = result;
    if (persistedId) {
      try {
        await resolveApprovalRequest(
          persistedId,
          decision === 'allow_always'
            ? 'approved_always'
            : decision === 'deny' || decision === 'steer'
            ? 'denied'
            : 'approved_once',
        );
      } catch {
        /* best-effort */
      }
    }
    if (decision === 'allow_always') {
      this.alwaysAllowed.add(partial.action.action);
      return { approved: true };
    }
    if (decision === 'steer') return { approved: false, feedback: result.feedback };
    return { approved: decision === 'allow_once' };
  }
}

/** Auto-approving service for fully-trusted / test contexts. */
export class AutoApprovalService implements ApprovalService {
  grantAlways(): void {}
  async request(): Promise<ApprovalOutcome> {
    return { approved: true };
  }
}
