// The configurable package allowlist for the isolated Python runtime.
//
// Rationale for the base set (kept deliberately small so the venv stays lean):
//   * pandas + numpy    — the core of any tabular analysis / stats / correlation.
//   * openpyxl          — read existing .xlsx structure for analysis (NOT the final
//                         artifact path — that stays on the Rust sheet.* engine).
//   * matplotlib        — chart/figure generation, saved as PNG into the run dir.
//   * python-docx (docx), python-pptx (pptx) — READING/inspecting existing Office
//                         files programmatically; never the polished output path.
//   * PyMuPDF (fitz)    — PDF inspection. Chosen over pdfplumber because it ships a
//                         single self-contained wheel with reliable prebuilt
//                         binaries on Windows/macOS/Linux (pdfplumber drags in the
//                         pdfminer.six chain), so the venv builds more reliably.
//   * requests          — network-only; allowed in code ONLY when the sandbox
//                         profile permits network, and that always needs approval.
//
// `importRoot` is the top-level module name as written in `import X`; `pip` is the
// install spec; `dist` is the lowercased distribution name `pip list` reports.

export interface AllowlistEntry {
  importRoot: string;
  pip: string;
  dist: string;
  /** Requires sandbox network access (and therefore always approval). */
  network?: boolean;
  /** Eagerly installed when the venv is first provisioned. */
  base?: boolean;
}

export const PACKAGE_ALLOWLIST: AllowlistEntry[] = [
  { importRoot: 'pandas', pip: 'pandas', dist: 'pandas', base: true },
  { importRoot: 'numpy', pip: 'numpy', dist: 'numpy', base: true },
  { importRoot: 'openpyxl', pip: 'openpyxl', dist: 'openpyxl', base: true },
  { importRoot: 'matplotlib', pip: 'matplotlib', dist: 'matplotlib', base: true },
  { importRoot: 'docx', pip: 'python-docx', dist: 'python-docx', base: true },
  { importRoot: 'pptx', pip: 'python-pptx', dist: 'python-pptx', base: true },
  { importRoot: 'fitz', pip: 'PyMuPDF', dist: 'pymupdf', base: true },
  { importRoot: 'requests', pip: 'requests', dist: 'requests', network: true },
];

const BY_ROOT = new Map(PACKAGE_ALLOWLIST.map((e) => [e.importRoot, e]));

export function allowlistEntryForImport(importRoot: string): AllowlistEntry | undefined {
  return BY_ROOT.get(importRoot);
}

/** The pip specs eagerly installed when the venv is first created. */
export function basePackages(): string[] {
  return PACKAGE_ALLOWLIST.filter((e) => e.base).map((e) => e.pip);
}
