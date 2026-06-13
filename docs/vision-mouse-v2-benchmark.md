# Vision Mouse V2 — Manual Benchmark Protocol

This is the manual acceptance protocol for the V2 element-first pipeline. It is
run by a human on a real Windows desktop with the V2 flag ON. The point is to
confirm the agent chooses **elements/text/hotkeys** and verifies results, rather
than guessing pixels.

## Setup

1. Enable V2: Settings → Automation → **Vision Mouse V2** ON (or
   `localStorage.larund_click_vision_v2 = "true"`, or build with
   `VITE_LARUND_CLICK_VISION_V2=true`).
2. (Optional) Enable artifact capture: `localStorage.larund_click_vision_v2_debug = "true"`.
   Artifacts land in `~/.larund-click/vision-v2-debug/<runId>/`.
3. Confirm each agent step is tagged `branch: v2` in the step details (legacy
   steps are tagged `branch: legacy`).

## What to log per task

| Field | Source |
|-------|--------|
| success / fail | final verification + visual confirmation |
| attempt count | number of V2 turns for the task |
| selected action | `tool` on the tool_call step (`v2:<action>`) |
| selected element_id | `details.chosenElementId` on the result step |
| used_method | `details.used_method` (dom / uia_invoke / hotkey / mouse_safe_point / mouse_raw …) |
| raw_click used? | `details.raw_click_used` (must be false for tasks 1–4 normally) |
| verification result | `details.verification` |
| fallback path | any `fallbackFrom: v2` markers / crop-refine entries in `details.coordinate_log` |
| time | wall-clock |
| failure reason | result `error` |

## Tasks

### 1. VS Code — Extensions panel
- **Goal:** "Nyisd meg a VS Code Extensions panelt."
- **Expected:** action `hotkey`, keys `ctrl+shift+x`; verification
  `panel_opened`/`text_appears` "Extensions"; `raw_click_used=false`.
- **Pass if:** the Extensions panel is visible and the step used a hotkey (not a
  pixel click).

### 2. Desktop — Google Chrome icon
- **Goal:** "Kattints a Google Chrome ikonra az asztalon."
- **Expected:** a desktop element resolves (UIA list item / text), action
  `click_element` or `click_text`; used_method `uia_invoke` or
  `mouse_safe_point` (computed point, not a guessed one); verification
  `window_changed` (Chrome foreground).
- **Pass if:** Chrome opens and the click targeted a resolved element.

### 3. Browser — address bar + URL
- **Goal:** "Nyisd meg a címsort és írj be egy URL-t."
- **Expected:** action `hotkey` `ctrl+l`, then `type_text` (with `press_enter`);
  verification `url_changed` / `text_appears`.
- **Pass if:** the URL is entered in the address bar via the shortcut, no pixel
  hunting for the bar.

### 4. Web — click a visible button
- **Goal:** "Kattints egy látható weboldali gombra."
- **Expected:** DOM provider active; action `click_element`/`click_text`;
  used_method `dom` (browser_click); `raw_click_used=false`.
- **Pass if:** the button is clicked via the DOM locator.

### 5. Form — fill a text field
- **Goal:** "Írj be szöveget egy input mezőbe."
- **Expected:** DOM input → used_method `dom` (browser_type), or UIA edit →
  `uia_value`; fallback `click_element` + keyboard typing.
- **Pass if:** the field contains the typed text.

## Mixed-mode (hybrid CLI + visual) tasks

These specifically exercise CLI ↔ visual switching within one loop. Watch the
`[V2] action … transition:` logs — you should see `cli→visual` / `visual→cli`.

### M1. CLI opens Chrome, then visual click
- **Goal:** "Nyisd meg Chrome-ot CLI-vel, majd vizuálisan kattints egy gombra."
- **Expected:** step 1 `cli_command` (or `browser_open`) → step 2 observes screen
  → step 3 `click_element`/`click_text` (DOM). Must NOT stay CLI-locked.

### M2. CLI opens VS Code, then hotkey Extensions
- **Goal:** "Nyisd meg a VS Code-ot CLI-vel, majd nyisd meg az Extensions panelt."
- **Expected:** step 1 `cli_command` `code` → step 2 observe → step 3
  `hotkey ctrl+shift+x`; verification Extensions visible.

### M3. CLI npm, then GUI click
- **Goal:** "Futtass egy npm parancsot CLI-ben, majd a GUI-ban kattints a megfelelő elemre."
- **Expected:** `cli_command npm …` (planner sees stdout/exit) → visual action.

### M4. CLI/browser_open URL, then DOM fill
- **Goal:** "Nyiss meg böngészőt URL-lel, majd DOM actionnel tölts ki egy inputot."
- **Expected:** `browser_open` → `type_text` into a DOM input (`browser_type`).

### M5. Visual fails → CLI/hotkey alternative
- **Goal:** force a failing `click_element`.
- **Expected:** verification fails → `RETRY CONTEXT` set → next step picks a
  different modality (hotkey/CLI), not the same blind click.

## Automated coverage of the hybrid path

`src/lib/vision-v2/__tests__/hybrid.test.ts` and
`hybrid-integration.test.ts` cover: cli_command → `shell_run` (+ CLI observation),
browser_open → CDP, destructive-CLI safety gate, and the two-turn **CLI opens
Chrome → DOM provider auto-activates → visual click** flow, asserting the planner
saw the previous CLI output and did not stay CLI-locked, plus failed-visual →
RETRY CONTEXT.

## Result log (fill in during a run)

| # | Task | success | attempts | action | element_id | used_method | raw_click | verification | time | notes |
|---|------|---------|----------|--------|-----------|-------------|-----------|--------------|------|-------|
| 1 | VS Code Extensions | | | | | | | | | |
| 2 | Chrome icon | | | | | | | | | |
| 3 | Address bar | | | | | | | | | |
| 4 | Web button | | | | | | | | | |
| 5 | Text field | | | | | | | | | |

## Automated coverage (proxy for the manual run)

The mock integration test `src/lib/vision-v2/__tests__/run-v2.integration.test.ts`
exercises the full ScreenState → planner → executor → verify path with mocked
Tauri/model backends and asserts:
- "open VS Code Extensions" → a `hotkey` plan that fires `key_combo ctrl+shift+x`;
- a `done` plan completes the task;
- an invalid planner output falls back to legacy;
- a risky ("Delete account") plan routes to `ask_user` and does **not** click.

Run: `npm test`.

## Local build blocker note

A full end-to-end run requires building the Tauri app. This repo builds via
`npm run tauri build` using a custom xwin/MSVC linker config (no Visual Studio
installed — see `project_linker_fix` in memory). If that build is unavailable in
your environment, record it here as the blocker for the live run; the logic is
otherwise covered by `cargo check` + the mock integration tests above.
