// Fast, UX-facing mirror of the Rust static isolation gate. This produces an
// early, human-readable reason BEFORE we spawn anything; the Rust side
// (commands/code_exec.rs::static_isolation_check) re-runs the authoritative
// version so the gate cannot be bypassed by calling the command directly.

export interface StaticCheckResult {
  ok: boolean;
  reason?: string;
}

const ESCAPE: Array<[RegExp, string]> = [
  [/\bimport\s+subprocess\b|\bsubprocess\./, 'spawning host processes (subprocess)'],
  [/\bos\.system\s*\(/, 'shell execution (os.system)'],
  [/\bos\.popen\s*\(/, 'shell execution (os.popen)'],
  [/\bos\.exec[lv]/, 'process replacement (os.exec*)'],
  [/\bos\.spawn/, 'process spawning (os.spawn*)'],
  [/\bos\.fork\s*\(/, 'forking (os.fork)'],
  [/\bimport\s+ctypes\b/, 'native memory access (ctypes)'],
  [/\bimport\s+cffi\b/, 'native FFI (cffi)'],
  [/\bmultiprocessing\b/, 'subprocess pools (multiprocessing)'],
  [/\bpty\.spawn\b/, 'pseudo-terminal spawning'],
];

const NETWORK: RegExp[] = [
  /\bimport\s+socket\b/, /\bimport\s+requests\b/, /\bimport\s+urllib\b/, /\bfrom\s+urllib\b/,
  /\bimport\s+http\.client\b/, /\bimport\s+httpx\b/, /\bimport\s+aiohttp\b/, /\bimport\s+ftplib\b/,
  /\bimport\s+smtplib\b/, /\bimport\s+telnetlib\b/, /\burllib\.request\b/, /\bsocket\.socket\b/,
];

const HOME_LOOKUP: Array<[RegExp, string]> = [
  [/\bexpanduser\b/, 'os.path.expanduser'],
  [/\bPath\.home\s*\(/, 'Path.home()'],
  [/\bos\.environ\b/, 'os.environ'],
  [/\bos\.getenv\b|\bgetenv\s*\(/, 'os.getenv'],
  [/%userprofile%/i, '%USERPROFILE%'],
  [/~\//, '~/ home reference'],
];

/** Reject absolute paths that escape the run dir. The run dir isn't known yet on
 *  the TS side, so we conservatively flag any absolute path literal that is NOT
 *  one of the declared input file basenames; Rust does the precise run-dir check. */
function absolutePathLiterals(code: string): string[] {
  const out: string[] = [];
  const re = /(['"])((?:[A-Za-z]:[\\/]|\\\\|\/)[^'"\n]{1,200})\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const lit = m[2];
    // ignore bare "/" or protocol-relative "//host"
    if (lit === '/' || lit.startsWith('//')) continue;
    out.push(lit);
  }
  return out;
}

function traversalLiterals(code: string): string[] {
  const out: string[] = [];
  const re = /(['"])([^'"\n]{1,200})\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const lit = m[2].replace(/\\/g, '/');
    if (lit === '..' || lit.startsWith('../') || lit.includes('/../')) out.push(m[2]);
  }
  return out;
}

export function preflightStaticCheck(
  code: string,
  opts: { allowNetwork?: boolean; inputNames?: string[] } = {},
): StaticCheckResult {
  for (const [re, why] of ESCAPE) {
    if (re.test(code)) return { ok: false, reason: `${why} is not allowed in the sandbox.` };
  }
  if (!opts.allowNetwork) {
    for (const re of NETWORK) {
      if (re.test(code)) {
        return {
          ok: false,
          reason: 'this code uses the network, which is disabled. Network access always requires approval — only enable it when the task truly needs it.',
        };
      }
    }
  }
  for (const [re, label] of HOME_LOOKUP) {
    if (re.test(code)) {
      return { ok: false, reason: `'${label}' reads outside the sandbox working directory. Use relative paths inside the run folder and the provided input files only.` };
    }
  }
  const traversal = traversalLiterals(code)[0];
  if (traversal) {
    return { ok: false, reason: `relative path traversal '${traversal}' would leave the sandbox. Use files inside the run folder only.` };
  }
  const inputs = new Set((opts.inputNames ?? []).map((n) => n.split(/[\\/]/).pop() ?? n));
  for (const lit of absolutePathLiterals(code)) {
    const base = lit.split(/[\\/]/).pop() ?? lit;
    if (!inputs.has(base)) {
      return { ok: false, reason: `absolute path '${lit}' points outside the sandbox. Reference inputs by file name (they are copied into the run folder) and write outputs with relative paths.` };
    }
  }
  return { ok: true };
}
