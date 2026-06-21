import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSkillFile } from '../src/lib/skills/frontmatter';
import { validateImportedSkillMarkdown } from '../src/lib/skills/import/safety';

const root = resolve(process.argv[2] ?? 'skills');
const skillFiles: string[] = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (entry.toLowerCase() === 'skill.md') skillFiles.push(path);
  }
}

walk(root);
let failed = 0;
for (const file of skillFiles) {
  const text = readFileSync(file, 'utf8');
  const parsed = parseSkillFile(text);
  if (parsed.error) {
    failed += 1;
    console.log(`ERROR ${file}: ${parsed.error}`);
    continue;
  }
  const validation = validateImportedSkillMarkdown(text);
  if (validation.errors.length) {
    failed += 1;
    console.log(`ERROR ${file}: ${validation.errors.join(', ')}`);
  }
  if (validation.warnings.length) console.log(`WARN ${file}: ${validation.warnings.join(', ')}`);
}

console.log(`Validated ${skillFiles.length} skill files. Failures: ${failed}.`);
if (failed) process.exit(1);
