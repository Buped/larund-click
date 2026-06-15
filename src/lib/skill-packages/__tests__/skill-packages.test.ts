import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { createBuilderSkill, listBuilderSkills } from '../../skills/builder/store';
import { exportSkillPackage, importSkillPackage, validateSkillPackage } from '../package';

beforeEach(() => resetRecordBackendForTests());

describe('skill packages', () => {
  it('exports, validates, and imports skills disabled by default', async () => {
    await createBuilderSkill({ userId: 'u1', workspaceId: 'ws1', name: 'Mailer', description: 'Send approved updates', riskLevel: 'external_send' });
    const pkg = await exportSkillPackage({ userId: 'u1', workspaceId: 'ws1', name: 'Ops Pack', description: 'Ops skills' });
    const validation = validateSkillPackage(pkg);
    expect(validation.ok).toBe(true);
    expect(validation.dangerousPermissions).toContain('external_send');
    await importSkillPackage({ userId: 'u2', workspaceId: 'ws2', pkg });
    const imported = await listBuilderSkills({ userId: 'u2', workspaceId: 'ws2' });
    expect(imported[0].source).toBe('imported');
    expect(imported[0].enabled).toBe(false);
  });

  it('rejects invalid packages', () => {
    expect(validateSkillPackage({ manifestVersion: '1.0', packageId: 'x', name: 'x', version: '1', description: 'x', skills: [], requestedPermissions: [], checksum: 'bad' }).ok).toBe(false);
  });
});
