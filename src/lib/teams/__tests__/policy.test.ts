import { describe, expect, it } from 'vitest';
import { canApproveWorkspaceTool, canUseApprovedTool, isReadOnlyRole } from '../policy';

describe('team policy helpers', () => {
  it('keeps single-user behavior open and constrains team roles', () => {
    expect(canApproveWorkspaceTool(null, true)).toBe(true);
    expect(canApproveWorkspaceTool({ teamId: 't', userId: 'u', role: 'member' }, false)).toBe(false);
    expect(canUseApprovedTool({ teamId: 't', userId: 'u', role: 'member' }, false)).toBe(true);
    expect(isReadOnlyRole({ teamId: 't', userId: 'u', role: 'viewer' })).toBe(true);
  });
});
