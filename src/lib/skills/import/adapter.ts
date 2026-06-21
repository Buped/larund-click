import { CLAUDE_TO_LARUND_TOOL_MAP, validateImportedSkillMarkdown } from './safety';

export interface AdaptedClaudeSkill {
  markdown: string;
  status: 'pending_review' | 'blocked';
  warnings: string[];
  errors: string[];
}

function replaceClaudeTools(text: string): string {
  let out = text;
  for (const [claude, larund] of Object.entries(CLAUDE_TO_LARUND_TOOL_MAP)) {
    out = out.replace(new RegExp(`\\b${claude}\\b`, 'g'), larund);
  }
  return out;
}

function hasFrontmatter(text: string): boolean {
  return /^---\s*\n[\s\S]*?\n---\s*\n?/.test(text);
}

function fallbackFrontmatter(name: string): string {
  return [
    '---',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(`Imported Claude skill adapted for Larund: ${name}`)}`,
    'version: "0.1.0"',
    'source: "imported"',
    'status: "pending_review"',
    'categories: ["imported"]',
    `trigger: ${JSON.stringify(name.replace(/[-_]/g, ' '))}`,
    'allowed_tools: ["file.read", "file.write", "browser.open", "browser.read", "connection.call", "ask_user"]',
    'requires_connections: []',
    'risk: "local_write"',
    'when_to_use: ["Use only after human review confirms the Larund tool mapping is appropriate."]',
    'when_not_to_use: ["Do not use if the task requires mouse, cursor, screenshot, pixel, or raw external scripts."]',
    'verification_checklist: ["Read source inputs before acting.", "Read back the produced or changed result before task.complete."]',
    '---',
  ].join('\n');
}

export function adaptClaudeSkillMarkdown(markdown: string, nameHint: string): AdaptedClaudeSkill {
  const adaptedBody = [
    replaceClaudeTools(markdown),
    '',
    '## Larund adaptation rules',
    '- Use only Larund no-mouse tools: CLI, files, documents, browser DOM/CDP, connections, MCP, workflows, and skills.',
    '- Do not use mouse, cursor, screenshots, OCR-clicks, coordinates, or pixel targeting.',
    '- Treat scripts as reference material unless separately reviewed and allowlisted.',
    '- Verify with read-back evidence before task.complete.',
  ].join('\n');
  const finalMarkdown = hasFrontmatter(adaptedBody)
    ? adaptedBody.replace(/^---\s*\n/, '---\nstatus: "pending_review"\n')
    : `${fallbackFrontmatter(nameHint)}\n\n${adaptedBody}`;
  const validation = validateImportedSkillMarkdown(finalMarkdown);
  return {
    markdown: finalMarkdown,
    status: validation.status === 'blocked' ? 'blocked' : 'pending_review',
    warnings: validation.warnings,
    errors: validation.errors,
  };
}
