// Render a selected role into a compact prompt block.

import type { RoleTemplate } from './types';

export function renderRolePrompt(role: RoleTemplate): string {
  const lines = [
    `## Active role: ${role.name}`,
    role.systemInstructions,
  ];
  if (role.defaultSkills.length) lines.push(`Preferred skills: ${role.defaultSkills.join(', ')}.`);
  return lines.join('\n');
}
