import type { TeamMember } from './types';

export function canApproveWorkspaceTool(member: TeamMember | null | undefined, singleUser = true): boolean {
  if (singleUser && !member) return true;
  return member?.role === 'owner' || member?.role === 'admin';
}

export function canUseApprovedTool(member: TeamMember | null | undefined, singleUser = true): boolean {
  if (singleUser && !member) return true;
  return member ? ['owner', 'admin', 'member'].includes(member.role) : false;
}

export function isReadOnlyRole(member: TeamMember | null | undefined): boolean {
  return member?.role === 'viewer';
}
