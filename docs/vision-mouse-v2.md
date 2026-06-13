# Vision Mouse V2

A robust perception + grounding + verified-execution layer for Larund Click.
It is **additive and opt-in**: with the feature flag OFF the agent behaves
exactly as before (legacy grid + raw-mouse). With it ON, screen perception is
routed through a unified `ScreenState`, the planner selects **UI elements** (not
pixels), and the executor performs the action the most stable way available and
verifies the result.

> Product philosophy: Larund Click is **not** an "AI mouse mover". The mouse is
> just one executor of last resort. The order of preference is:
> 1. app/browser API or DOM locator
> 2. UI Automation Invoke/Value/Toggle/Selection/Scroll pattern
> 3. known hotkey / command palette
> 4. OCR text click
> 5. OmniParser / Set-of-Mark label click
> 6. crop + zoom refined click
> 7. raw x,y mouse click — only as the final fallback

## Status — fully wired

| Phase | Scope | State |
|------|-------|-------|
| 1 | Foundation: config flag, data model, coordinate service, geometry/text/plan utils, unit tests | ✅ done |
| 2 | `buildScreenState()` + provider adapters (UIA, DOM, OCR/OmniParser stubs) + merge/dedup | ✅ done |
| 3 | ActionPlan planner prompt + schema validation wiring | ✅ done |
| 4 | Action executor with enforced fallback order + verification layer | ✅ done |
| 5 | Crop + zoom re-grounding, debug/log artifacts (JSON + before/after) | ✅ done |
| 6 | Feature-flag branch in the agent loop, app-shortcut registry, safety gate, benchmark | ✅ done |

When the flag is ON, `runAgentLoop` (in [agent-loop.ts](../src/lib/agent-loop.ts))
calls `runVisionV2Turn` ([run-v2.ts](../src/lib/vision-v2/run-v2.ts)) each
iteration: build ScreenState → plan → safety gate → execute (with crop/refine
before any raw click) → verify → emit steps + save artifacts. A V2 fallback (bad
plan, no usable target, provider error) drops that single iteration to the
unchanged legacy path; the loop never crashes.

## Hybrid CLI + visual (one loop, not two modes)

Larund Click is a **hybrid** computer-use agent: CLI and visual UI actions are
complementary tools in the *same* loop, not mutually exclusive modes. There is no
"CLI mode" / "visual mode" lock — the planner re-decides the modality **every
step** from a fresh HybridState.

**HybridState** = what the planner sees each step (built in run-v2 + planner):
the user goal, the previous `ActionResult`, the **previous CLI output**
(`CliObservation`: command/stdout/stderr/exitCode, kept in `V2Memory.lastCli`),
the active window, a clean screenshot, and the merged element list. So the
planner sees the CLI output **and** the screen state together.

- `cli_command` (→ `shell_run`) is a first-class action: launch apps, file/git/
  npm/cargo/powershell/build work. After a CLI command that opens/changes a GUI,
  the **next** step's `buildScreenState` re-observes the screen automatically
  (every turn observes — there's no "skip screenshot after CLI" path), and the
  DOM provider auto-activates once `browser_probe` reports Chrome is up.
- `browser_open` (→ CDP `browser_open`) navigates the *controllable* browser so
  DOM actions work afterwards (preferred over `start chrome <url>`).
- **Modality switching** is logged per step (`[V2] action … transition:
  cli→visual | visual→cli`). CLI→visual is expected after a GUI-opening command;
  visual→CLI when shell work is faster or a visual action keeps failing (the
  failure sets a `RETRY CONTEXT` fed to the next plan).
- The safety gate ([safety.ts](../src/lib/vision-v2/safety.ts)) also inspects the
  `command` text, so destructive shell (`rm -rf`, `git push --force`, `format`,
  `reg delete`, …) routes to `ask_user`.

## Feature flag

Resolution order (first hit wins), so V2 can be toggled from any layer
([config.ts](../src/lib/vision-v2/config.ts)):

1. Vite env var `VITE_LARUND_CLICK_VISION_V2=true`
2. `localStorage["larund_click_vision_v2"] = "true"`
3. tauri-plugin-store `auth.dat` key `vision_v2 = true` (Settings → Automation → **Vision Mouse V2**)
4. default: `false`

```ts
import { isVisionV2Enabled, setVisionV2Enabled } from './lib/vision-v2/config';
if (isVisionV2Enabled()) { /* V2 path */ }
await setVisionV2Enabled(true); // persist user choice (Settings toggle does this)
```

The agent loop resolves the flag once per task (sync env+localStorage). The
legacy path is never deleted — it is the fallback when V2 is off, when no
provider yields a target, or when any provider/planner is unavailable.

## ActionPlan schema

The planner returns ONE JSON object validated by
[plan-schema.ts](../src/lib/vision-v2/plan-schema.ts):

```jsonc
{
  "action": "cli_command|browser_open|hotkey|click_element|click_text|click_label|type_text|scroll|raw_click|wait|done|ask_user",
  "command": "code .", "working_dir": "...",   // cli_command
  "url": "https://example.com",                 // browser_open
  "target": { "element_id": "uia_fg|3", "text": "Extensions", "x": 0, "y": 0 },
  "text": "...", "keys": ["ctrl","shift","x"], "direction": "down",
  "clear_before_typing": false, "press_enter": true,
  "reason": "...", "confidence": 0.0,
  "expect": { "type": "text_appears", "value": "Extensions", "timeout_ms": 2500, "required": true }
}
```

Invalid output → one repair retry → else `fallback_legacy`.

## Executor fallback order (enforced in code)

[executor.ts](../src/lib/vision-v2/executor.ts) routes every action. Non-click
actions go directly to their tool (`cli_command`→`shell_run`,
`browser_open`→CDP, `hotkey`→`key_combo`, `type_text`→DOM/UIA/keyboard,
`scroll`→UIA/wheel). A click resolves by the element's source, in order:

1. **DOM** locator → `browser_click` / `browser_type` (no pixels)
2. **UIA** programmatic → `desktop_invoke_target` / `desktop_type_target`, then `desktop_click_target`
3. **hotkey** (when [shortcuts.ts](../src/lib/vision-v2/shortcuts.ts) covers the intent)
4. **safe-point mouse** → `safeClickPoint` + `validateScreenPoint` → `mouse_click`
5. **crop/refine** → `desktop_visual_locate` → refined mouse click
6. **raw_click** — last resort, validated on-screen, repeat-guarded

## Verification

[verify.ts](../src/lib/vision-v2/verify.ts) checks the post-action ScreenState:
`text_appears`/`text_disappears` (UIA/DOM text), `window_changed`,
`panel_opened`, `focus_changed`, `url_changed`, `visual_change` (coarse
screenshot diff), `llm_check` (soft pass), `none`. Failed required verification
sets a retry context so the planner changes strategy instead of repeating.

## Crop / refine

[crop-refine.ts](../src/lib/vision-v2/crop-refine.ts) reuses
`desktop_visual_locate` / `desktop_zoom_target_region`. It triggers when a
structured click can't be made precisely (low confidence, tiny/ambiguous target,
`target_not_precise_enough`, or we'd otherwise need a raw click), and transforms
crop-local points back to screen coords (`cropToScreenPoint`).

## Safety gate

[safety.ts](../src/lib/vision-v2/safety.ts) classifies a plan's text against
delete/payment/send/credentials/system terms. High-risk actions are converted to
an `ask_user` confirmation by the orchestrator — never auto-clicked.

## How ScreenState works

`ScreenState` ([types.ts](../src/lib/vision-v2/types.ts)) is the single contract
between perception, planner, executor and verifier. It records the screenshot
metrics, the active window, and a merged list of `ScreenElement`s gathered from
multiple sources.

Each `ScreenElement` carries a stable `id`, its `source`, semantic fields
(`role`/`name`/`text`), an absolute-pixel `bbox` + `center` + `clickable_point`,
a `confidence`, and a `metadata` blob holding what the executor needs to act
**without the mouse** (a DOM selector, or a UIA `snapshot_token` + target id +
invoke capability).

## Coordinate calibration

All coordinate conversions live in ONE place
([coordinates.ts](../src/lib/vision-v2/coordinates.ts)) — never inline them.
Spaces handled: screen (absolute OS px), screenshot (captured image px),
normalized (0..999), and window-relative. Key functions:
`getScreenMetrics`, `getScreenshotMetrics`, `getActiveWindowRect`,
`normalizedToPixel`, `pixelToNormalized`, `screenshotToScreenPoint`,
`screenToScreenshotPoint`, `clampPointToScreen`, `validateScreenPoint`,
`boundsToBBox`.

## Provider pipeline

`buildScreenState()` ([screen-state.ts](../src/lib/vision-v2/screen-state.ts))
captures a clean (grid-free) screenshot + metrics, runs the available providers
best-effort, merges their elements, and returns a `ScreenState`. A thrown
provider contributes no elements rather than failing the build.

| Provider | Backed by | Notes |
|----------|-----------|-------|
| DOM | `browser_read` (CDP, [browser.rs](../src-tauri/src/commands/browser.rs)) | text/role/selector, **no pixels**; acts via `browser_click`/`browser_type`. Gated on `browser_probe` / `webHint` so Chrome isn't auto-launched. |
| UIA | `desktop_read` (PowerShell UIAutomation, [desktop.rs](../src-tauri/src/commands/desktop.rs)) | name/role/automation_id/bounds + invoke/value/scroll + snapshot_token |
| OCR | [providers/ocr.ts](../src/lib/vision-v2/providers/ocr.ts) | wired adapter, returns `[]` this pass; drop-in `Windows.Media.Ocr` later |
| OmniParser | [providers/omniparser.ts](../src/lib/vision-v2/providers/omniparser.ts) | adapter/stub; optional, only if configured |
| Grid | legacy `take_screenshot` grid ([agent.rs](../src-tauri/src/commands/agent.rs)) | legacy path / final fallback only |

The merger ([merge.ts](../src/lib/vision-v2/merge.ts)) dedups by IoU + text/role,
applies source priority (`SOURCE_PRIORITY`: dom > uia > ocr > omniparser >
vision > grid), records all contributing sources in `metadata.sources[]`, boosts
confidence when sources agree, drops invisible/zero-size/off-screen elements, and
pushes clickable elements forward.

## Debugging

When `localStorage.larund_click_vision_v2_debug = "true"`, each step writes
artifacts to `~/.larund-click/vision-v2-debug/<runId>/`
([debug.ts](../src/lib/vision-v2/debug.ts)): a per-step JSON (plan, raw plan,
result, verification, provider stats, coordinate-conversion log, before/after
ScreenState with base64 stripped) plus the before/after screenshots. The planner
always receives a **clean** screenshot + the structured element list — overlays
are saved to disk, not fed back, unless Set-of-Mark mode is added later.

## Adding a new provider

1. Implement a function returning `ScreenElement[]` (set `source`, `bbox`,
   `clickable_point`, `confidence`, and a `metadata` payload the executor can act
   on — a DOM target, or a UIA id + snapshot_token + invoke flag).
2. Add it to the provider list in `buildScreenState()`.
3. Slot its `source` into `SOURCE_PRIORITY` in [types.ts](../src/lib/vision-v2/types.ts).
4. Teach `executor.ts` how to act on it if it needs a non-mouse path.

## Testing & benchmarking

```bash
npm test          # 82 unit + mock-integration tests
npm run test:watch
npx tsc --noEmit -p tsconfig.json
```

Manual acceptance protocol: [vision-mouse-v2-benchmark.md](./vision-mouse-v2-benchmark.md)
(VS Code Extensions, Chrome icon, address bar, web button, form fill — logging
success/attempts/action/element/used_method/raw_click?/verification/time).

## Known limitations

- OCR / OmniParser are wired stubs (return `[]`); `click_text` runs off UIA + DOM
  text this pass. Real `Windows.Media.Ocr` is a documented drop-in.
- DOM elements have no screen bbox (acted via `browser_click` only).
- `visual_change` verification is a coarse base64 diff; `llm_check` is a soft pass.
- Debug artifacts are JSON + before/after screenshots (no drawn overlay PNGs yet).
- Only the primary monitor is exercised.
- In V2, `buildScreenState` (screenshot + UIA `desktop_read`) runs every step,
  including pure-CLI steps — correctness over speed; the planner can still chain
  CLI quickly. A future optimization can skip the screenshot when there's no GUI
  context.
