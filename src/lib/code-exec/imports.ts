// Lightweight top-level import extraction + classification for agent-authored
// Python. This is NOT a parser — it scans line starts for `import x` / `from x
// import ...` to decide which third-party packages a snippet needs, so the
// runtime can (a) auto-provide allowlisted packages and (b) refuse to silently
// install anything else (it must go through the approval-gated install path).

import { allowlistEntryForImport, type AllowlistEntry } from './allowlist';

// A pragmatic subset of the Python 3 standard library — enough that ordinary
// analysis snippets (statistics, csv, json, re, math, datetime, collections…)
// never get misclassified as "needs a package".
const STDLIB = new Set<string>([
  'abc', 'argparse', 'ast', 'asyncio', 'base64', 'bisect', 'calendar', 'collections',
  'contextlib', 'copy', 'csv', 'datetime', 'decimal', 'difflib', 'enum', 'functools',
  'gc', 'getpass', 'glob', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'io', 'itertools',
  'json', 'logging', 'math', 'numbers', 'operator', 'os', 'pathlib', 'pickle', 'pprint',
  'queue', 'random', 're', 'secrets', 'shutil', 'statistics', 'string', 'struct', 'sys',
  'tempfile', 'textwrap', 'time', 'timeit', 'traceback', 'typing', 'unicodedata', 'uuid',
  'warnings', 'zipfile', 'zlib', 'fractions', 'array', 'dataclasses', 'types', 'inspect',
]);

export interface ImportClassification {
  /** Distinct top-level modules referenced. */
  roots: string[];
  stdlib: string[];
  /** Allowlist entries that need to be present in the venv. */
  allowlist: AllowlistEntry[];
  /** Modules that are neither stdlib nor allowlisted (require approval to install). */
  unknown: string[];
  /** True if any referenced package needs network access. */
  needsNetwork: boolean;
}

export function extractTopLevelImports(code: string): string[] {
  const roots = new Set<string>();
  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.trim();
    let m = /^import\s+(.+)$/.exec(line);
    if (m) {
      // `import a, b.c as d` → roots a, b
      for (const part of m[1].split(',')) {
        const mod = part.trim().split(/\s+as\s+/)[0].trim().split('.')[0];
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(mod)) roots.add(mod);
      }
      continue;
    }
    m = /^from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+/.exec(line);
    if (m) {
      const mod = m[1].split('.')[0];
      if (mod && mod !== '.') roots.add(mod);
    }
  }
  return [...roots];
}

export function classifyImports(code: string): ImportClassification {
  const roots = extractTopLevelImports(code);
  const stdlib: string[] = [];
  const allowlist: AllowlistEntry[] = [];
  const unknown: string[] = [];
  let needsNetwork = false;

  for (const root of roots) {
    if (STDLIB.has(root)) {
      stdlib.push(root);
      continue;
    }
    const entry = allowlistEntryForImport(root);
    if (entry) {
      allowlist.push(entry);
      if (entry.network) needsNetwork = true;
    } else {
      unknown.push(root);
    }
  }
  return { roots, stdlib, allowlist, unknown, needsNetwork };
}
