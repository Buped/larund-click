import type { ToolRisk } from '../tools/types';
import type { SkillBuilderSkill } from '../skills/builder/types';
import type { WorkflowTemplate } from '../workflows/templates/types';

export interface SkillPackage {
  manifestVersion: string;
  packageId: string;
  name: string;
  version: string;
  publisher?: string;
  description: string;
  skills: SkillBuilderSkill[];
  workflowTemplates?: WorkflowTemplate[];
  requiredConnections?: string[];
  requiredMcpServers?: string[];
  requestedPermissions: ToolRisk[];
  signature?: string;
  checksum: string;
}

export interface SkillPackageValidation {
  ok: boolean;
  errors: string[];
  dangerousPermissions: ToolRisk[];
  checksum: string;
  signatureVerified: boolean;
}
