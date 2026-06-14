import type { ApprovalRequest, ApprovalService } from './types';

let approvalCounter = 0;
function newApprovalId(): string {
  approvalCounter += 1;
  return `appr-${Date.now()}-${approvalCounter}`;
}

export type ApprovalPrompt = (req: ApprovalRequest) => Promise<'allow_once' | 'allow_always' | 'deny'>;

/**
 * Approval service backed by a UI prompt callback. When no prompt is wired
 * (e.g. headless tests), the `defaultDecision` is used.
 */
export class PromptApprovalService implements ApprovalService {
  private alwaysAllowed = new Set<string>();

  constructor(
    private prompt?: ApprovalPrompt,
    private defaultDecision: 'allow_once' | 'deny' = 'deny',
  ) {}

  grantAlways(actionName: string): void {
    this.alwaysAllowed.add(actionName);
  }

  async request(partial: Omit<ApprovalRequest, 'id' | 'createdAt'>): Promise<boolean> {
    if (this.alwaysAllowed.has(partial.action.action)) return true;
    const req: ApprovalRequest = { ...partial, id: newApprovalId(), createdAt: Date.now() };
    const decision = this.prompt ? await this.prompt(req) : this.defaultDecision;
    if (decision === 'allow_always') {
      this.alwaysAllowed.add(partial.action.action);
      return true;
    }
    return decision === 'allow_once';
  }
}

/** Auto-approving service for fully-trusted / test contexts. */
export class AutoApprovalService implements ApprovalService {
  grantAlways(): void {}
  async request(): Promise<boolean> {
    return true;
  }
}
