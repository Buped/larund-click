import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSkillFile } from '../src/lib/skills/frontmatter.ts';
import { validateImportedSkillMarkdown } from '../src/lib/skills/import/safety.ts';

const root = resolve(process.argv[2] ?? 'skills');
const skillFiles: string[] = [];
const IMPORT_STATUS = new Set(['pending_review', 'reviewed', 'enabled', 'disabled', 'blocked', 'deprecated']);

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

  const isImported =
    file.split(/[\\/]/).some((part) => part.toLowerCase() === 'imported') ||
    Boolean(parsed.manifest?.origin_repo) ||
    Boolean(parsed.manifest?.status && IMPORT_STATUS.has(parsed.manifest.status));

  if (isImported) {
    const validation = validateImportedSkillMarkdown(text);
    if (validation.errors.length) {
      failed += 1;
      console.log(`ERROR ${file}: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length) console.log(`WARN ${file}: ${validation.warnings.join(', ')}`);
    continue;
  }

  const warnings: string[] = [];
  if (parsed.manifest?.risk !== 'read_only' && !parsed.manifest?.verification_checklist?.length) {
    warnings.push('missing_frontmatter_verification_checklist_using_runtime_default');
  }
  if (!parsed.manifest?.when_to_use?.length) warnings.push('missing_when_to_use_using_runtime_default');
  if (!parsed.manifest?.when_not_to_use?.length) warnings.push('missing_when_not_to_use_using_runtime_default');
  if (warnings.length) console.log(`WARN ${file}: ${warnings.join(', ')}`);
}

console.log(`Validated ${skillFiles.length} skill files. Failures: ${failed}.`);
if (failed) process.exit(1);
