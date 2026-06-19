# Larund Operator Benchmarks

A structured, extensible benchmark suite for the Larund Click **local-first, no-mouse
AI operator**. Each benchmark describes a real customer task and the exact tools,
artifacts, verification and safety it must respect. The suite is *data*, lives in
[`src/lib/benchmarks/`](../src/lib/benchmarks/), and is scored by a static readiness
runner so the audit stays in sync with the code.

> No-mouse contract: benchmarks never allow mouse/cursor/screenshot-click/OCR-click/
> coordinate/visual-target actions. The runtime rejects those by name
> (`isLegacyVisualActionName`) and the runner asserts none leak into any benchmark.

## Files

| File | Purpose |
| ---- | ------- |
| [`benchmarkTypes.ts`](../src/lib/benchmarks/benchmarkTypes.ts) | `BenchmarkDefinition` + scoring/artifact types; universal forbidden tools. |
| [`capabilities.ts`](../src/lib/benchmarks/capabilities.ts) | Capability matrix: each operator capability, its backing actions, status and evidence. |
| [`benchmarkCatalog.ts`](../src/lib/benchmarks/benchmarkCatalog.ts) | The 18 reference benchmarks. |
| [`benchmarkRunner.ts`](../src/lib/benchmarks/benchmarkRunner.ts) | Static readiness scoring + markdown report rendering. |
| [`__tests__/benchmarks.test.ts`](../src/lib/benchmarks/__tests__/benchmarks.test.ts) | Integrity + consistency + readiness tests. |

## Benchmark definition shape

Every benchmark carries: `id`, `title`, `userPrompt`, `category`,
`requiredCapabilities`, `allowedTools`, `forbiddenTools`, `setup`,
`expectedArtifacts`, `verificationCriteria`, `safetyRequirements`, `scoring`
(0–3 rubric) and `knownLimitations`.

## Scoring (0–3)

| Score | Meaning |
| ----- | ------- |
| 0 | Could not start, or used a forbidden tool / did the wrong thing. |
| 1 | Partially done, much manual help, verification skipped. |
| 2 | Done with a minor mistake or a little guidance; mostly verified. |
| 3 | Done autonomously, safely, with read-back verification. |

For **every** benchmark run, also check:

- an output artifact was actually produced,
- it landed in the right place,
- it was read back / verified,
- the required approval was requested,
- no forbidden tool was used,
- the run did not close with a false `task.complete`.

These map to real code: the completion guard
([`completion-guard.ts`](../src/lib/control-system/completion-guard.ts) +
[`goal-verifier.ts`](../src/lib/control-system/goal-verifier.ts)) rejects unverified
completions, the risk policy ([`policy.ts`](../src/lib/tools/policy.ts)) gates
approvals, and the audit log ([`audit.ts`](../src/lib/tools/audit.ts)) redacts secrets.

## Two ways to run

1. **Static readiness (implemented, automated).** `evaluateSuite()` checks each
   benchmark's required capabilities against the capability matrix and its
   allowed/forbidden tools against the parser allow-list + no-mouse guard. It returns
   `ready | partial | blocked`. `renderReadinessMarkdown()` prints the capability
   matrix + per-benchmark table. Covered by `benchmarks.test.ts` (`npx vitest run
   src/lib/benchmarks`).

2. **Live, model-in-the-loop (manual / future).** Drive `runControlLoop` with each
   `userPrompt` against **local fixtures / sandbox pages only** (never a real customer
   site) and score 0–3 by hand using the rubric + the mandatory checks above. The
   catalog is intentionally reusable for this without changes.

## The 18 benchmarks

| ID | Title | Category | Key capabilities |
| -- | ----- | -------- | ---------------- |
| B01 | Invoice download from web portal | accounting | browser.login, browser.download, file_ops |
| B02 | Accounting preparation from downloaded invoices | accounting | folder_scan, pdf_extraction, sheet_io |
| B03 | Invoice collection from email or webmail | email | browser.login, browser.download, file_ops |
| B04 | Client onboarding folder setup | onboarding | file_ops, doc_write |
| B05 | Meeting note to follow-up and task list | content | document_read, doc_write |
| B06 | Lead enrichment from spreadsheet | sales | sheet_io, browser.read |
| B07 | Webshop product data preparation | ecommerce | sheet_io, sheet_export |
| B08 | Shopify admin product audit | ecommerce | app_mention, browser.read, doc_write |
| B09 | Weekly webshop order summary | reporting | browser.extract_table, doc_write |
| B10 | WordPress draft creation | content | browser.type, approval_policy |
| B11 | Proposal draft from client brief | content | document_read, doc_write |
| B12 | CRM update after meeting | crm | browser.login, approval_policy |
| B13 | Project status report from folder and task list | reporting | folder_scan, doc_write |
| B14 | Downloads folder cleanup | file_management | file_ops (no delete), document_read |
| B15 | Simple landing page creation | content | document_read, doc_write |
| B16 | Scheduled daily business brief | automation | workflow_scheduling, recovery_after_failure |
| B17 | Online form fill with approval before submit | forms | browser.type, approval_policy |
| B18 | Turn one-off task into reusable workflow | automation | workflow_scheduling, doc_write |

See [`BENCHMARK_AUDIT_REPORT.md`](./BENCHMARK_AUDIT_REPORT.md) for the current
per-benchmark readiness and the capability matrix with evidence.

## Safety rules for running benchmarks

- Never put a password in a prompt; logins go through `browser.login` (vault).
- Never log secrets; the audit logger redacts tokens/passwords/keys.
- Never add mouse/visual/SOC actions.
- Never publish/send/delete without approval.
- Never test against a real, live customer site — use mock/local fixtures or a sandbox.
- A real browser test may use the existing CDP path or Playwright; do not force a
  large framework migration.
