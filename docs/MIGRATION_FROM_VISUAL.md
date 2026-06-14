# Migration: from Visual/Mouse to No-Mouse Operator

This release removes all mouse/cursor/visual control from the agent core.

## Deleted (TypeScript)

- `src/lib/soc-port/` — the entire Self-Operating-Computer port (loop, model,
  ocr, label, screenshot, executor, router, validator, debug, config, prompts,
  types, and its tests).
- `src/lib/soc-mode/` — empty legacy dir.
- `docs/soc-port-benchmark.md`.
- Old visual tests (`control-system/__tests__` parser/loop tests asserting SOC).

> Note: `vision-v2`, `visual-controller.ts`, `visual-map.ts`, `grid.ts`,
> `qwen-grounder.ts`, `target-resolver.ts`, `mouse-kernel.ts`, `verifier.ts`
> were already removed in prior commits — they did not exist in this tree.

## Removed actions

- `soc.visual` — the only visual cursor route — is gone.
- All `mouse_*`, `cursor.*`, `visual.*`, `desktop_click_point`,
  `click_visual_target`, `ground_visual_target`, bbox/coordinate/ocr-click names
  are rejected by the parser (`isLegacyVisualActionName`, kept as a migration
  guard proven by tests).

## Rewritten

- `control-system/types.ts` — new no-mouse `ControlAction` union.
- `control-system/parser.ts` — closed allow-list + legacy guard.
- `control-system/prompt.ts` — no-mouse system prompt.
- `control-system/executor.ts` — pure dispatcher, no visual case.
- `control-system/loop.ts` — clean loop (no input-guard / minimize / screenshot
  / SOC-after-launch machinery); routes through the guarded runner.
- `agent-tools.ts` — uses the guarded runner.
- `components/chat.tsx` — screenshot rendering removed.

## Native (Rust)

The low-level `mouse_*`, `take_screenshot`, `soc_*`, `desktop_*` (UIA) and
`ocr_*` commands still compile and are registered, but are **no longer reachable
from the agent core** (nothing in the TS tool surface invokes them). They can be
deleted in a follow-up. New structured commands were added:
`fs_mkdir/copy/move/delete/exists/metadata/tree/search` (`fs_ops.rs`) and
`process_start/status/kill` (`process.rs`).

## New modules

- `src/lib/tools/` — registry, policy, audit, approvals, guarded `run.ts`.
- `src/lib/skills/` — frontmatter parser, loader, runner + `/skills/*.SKILL.md`.
- `src/lib/connections/` — registry, secrets, provider manifests/tools.
- `src/lib/workflows/` — engine, store, runner.
- `src/components/operator-panel.tsx` — Connections/Skills/Workflows UI.

## How to add capability now

- **A new tool** → see [TOOLS.md](TOOLS.md).
- **A new connection** → add a manifest + tools under
  `connections/providers/<id>/` and register it in `registry.ts`.
- **A new skill** → drop a `SKILL.md` under `/skills` (and mirror in
  `skills/bundled.ts` if it should ship with the app).
