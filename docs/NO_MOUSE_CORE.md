# No-Mouse Core

Larund Click's agent core **does not control the mouse or cursor**. There is no
screenshot-click, OCR-click, bbox, coordinate, grid, target-resolver, visual
grounding or Self-Operating-Computer path anywhere in the runtime.

## Why

Pixel/visual cursor control (the old SOC mode) was unreliable, unauditable, and
impossible to run safely on the live desktop. The product direction is now a
stable, auditable operator that uses **structured** tools.

## What to use instead

1. **Connections / APIs** — the most reliable path (GitHub, Notion, …).
2. **CLI / files** — `cli.run`, `file.*`, `sheet.*`, `process.*`.
3. **Browser DOM** — `browser.*` drives websites by element text / CSS selector
   over CDP, never by pixels.
4. **App launch + deterministic keyboard** — `app.open`, `window.focus`,
   `keyboard.combo` for known shortcuts only.

## Unsupported GUI-only tasks

If a task can *only* be done by clicking inside a GUI app, Larund does **not**
guess, screenshot, or click. It instead:

- finds an API / CLI / export / browser alternative, or
- calls `ask_user` to request a manual step or an alternative input.

Example response:

```json
{"action":"ask_user","question":"This app can only be driven by mouse, which the Larund core does not support. Please provide API/CSV/export access, or do this step manually and I'll continue."}
```

## Enforcement

- `parser.ts` rejects any action not in the closed allow-list, and explicitly
  rejects legacy `mouse.*`, `cursor.*`, `visual.*`, `soc.*`,
  `desktop_click_point`, `click_visual_target`, `ground_visual_target`, bbox /
  coordinate / ocr-click names (`isLegacyVisualActionName`).
- `loop.ts` detects an attempted legacy action by name, rejects it, and
  re-instructs the model.
- The system prompt states the no-mouse contract explicitly.
- Tests in `control-system/__tests__/parser.test.ts` and `loop.test.ts` prove
  the contract.
