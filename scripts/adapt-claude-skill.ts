import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { adaptClaudeSkillMarkdown } from '../src/lib/skills/import/adapter';

const [, , source, targetArg] = process.argv;
if (!source) {
  console.error('Usage: node scripts/adapt-claude-skill.ts <source SKILL.md> [target dir]');
  process.exit(1);
}

const sourcePath = resolve(source);
const nameHint = basename(dirname(sourcePath)) || basename(sourcePath, '.md');
const targetDir = resolve(targetArg ?? join('skills', 'imported', nameHint));
mkdirSync(targetDir, { recursive: true });

const adapted = adaptClaudeSkillMarkdown(readFileSync(sourcePath, 'utf8'), nameHint);
writeFileSync(join(targetDir, 'SKILL.md'), adapted.markdown, 'utf8');
writeFileSync(join(targetDir, 'larund.json'), JSON.stringify({
  id: `imported:${nameHint}`,
  name: nameHint,
  source: 'imported',
  importStatus: adapted.status,
  safety: { errors: adapted.errors, warnings: adapted.warnings },
}, null, 2), 'utf8');

console.log(`${adapted.status}: ${targetDir}`);
if (adapted.errors.length) console.log(`errors: ${adapted.errors.join(', ')}`);
if (adapted.warnings.length) console.log(`warnings: ${adapted.warnings.join(', ')}`);
