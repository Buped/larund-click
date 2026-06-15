import type { ToolRisk } from '../tools/types';

export interface SandboxProfile {
  id: string;
  name: string;
  description: string;
  filesystemRoots: string[];
  networkAllowlist: string[];
  allowedRiskLevels: ToolRisk[];
  allowProcessExec: boolean;
  allowCredentialAccess: boolean;
  allowExternalSend: boolean;
  requireApprovalFor: ToolRisk[];
}

export interface SandboxDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  profileId: string;
}
