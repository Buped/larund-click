import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { adaptClaudeSkillMarkdown } from '../src/lib/skills/import/adapter';

const [, , sourceRootArg, targetRootArg] = process.argv;
if (!sourceRootArg) {
  console.error('Usage: node scripts/import-claude-skills.ts <cloned claude-skills root> [target root]');
  process.exit(1);
}

const sourceRoot = resolve(sourceRootArg);
const targetRoot = resolve(targetRootArg ?? join('skills', 'imported'));
const quarantineName = 'scripts_quarantine';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (/skill\.md$/i.test(entry) || extname(entry).toLowerCase() === '.md') out.push(path);
  }
  return out;
}

const mdFiles = walk(sourceRoot);
mkdirSync(targetRoot, { recursive: true });
let imported = 0;
let blocked = 0;

for (const file of mdFiles) {
  const rel = relative(sourceRoot, file);
  const nameHint = basename(dirname(file)).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const targetDir = join(targetRoot, nameHint || basename(file, '.md'));
  const adapted = adaptClaudeSkillMarkdown(readFileSync(file, 'utf8'), nameHint);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'SKILL.md'), adapted.markdown, 'utf8');
  writeFileSync(join(targetDir, 'larund.json'), JSON.stringify({
    id: `imported:${nameHint}`,
    name: nameHint,
    source: 'imported',
    origin: { repo: 'alirezarezvani/claude-skills', path: rel, adapted: true },
    importStatus: adapted.status,
    safety: { errors: adapted.errors, warnings: adapted.warnings },
  }, null, 2), 'utf8');

  const sourceDir = dirname(file);
  for (const entry of readdirSync(sourceDir)) {
    const path = join(sourceDir, entry);
    if (path === file || !statSync(path).isFile()) continue;
    const ext = extname(entry).toLowerCase();
    const subdir = ['.py', '.sh', '.ps1', '.bat', '.cmd', '.js', '.ts'].includes(ext) ? quarantineName : 'references';
    mkdirSync(join(targetDir, subdir), { recursive: true });
    if (existsSync(path)) cpSync(path, join(targetDir, subdir, entry), { force: true });
  }

  imported += 1;
  if (adapted.status === 'blocked') blocked += 1;
}

console.log(`Imported ${imported} markdown skills to ${targetRoot}. Blocked: ${blocked}.`);
console.log('Script-like assets were copied as references/scripts_quarantine only; nothing was executed.');
