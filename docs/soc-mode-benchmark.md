# SOC Mode Benchmark

## Acceptance Task

Run Larund Click in Agent mode and ask:

`Nyisd meg a Robloxot es lepj be a Ground War / legutobb jatszott jatekba eger segitsegevel.`

## Expected Trace

1. The top-level router uses `app.open` / `desktop_open_app` to launch Roblox.
2. The next active step is mandatory `soc.visual`, not task completion.
3. SOC captures a fresh desktop screenshot before the model call.
4. SOC runs OCR and reports an OCR box count.
5. SOC builds a label map and a red-box labeled overlay.
6. The model chooses `click_text` or `click_label` for `Ground War` / the recent-game card. Raw mouse is only allowed as SOC `click` with percent metadata, and should be last resort.
7. The executor clicks the OCR/label bbox center through `mouse_click_verified` with `soc-ocr` or `soc-label` metadata.
8. SOC captures an after screenshot.
9. If there is no visual change, failure memory blocks the same or nearby click point.
10. The model tries an alternate grounded target, such as a grouped card label.
11. SOC accepts `done` only when the detail page, loading screen, or in-game state is visible.

## Fails If

- Solitaire or another app opens instead of Roblox.
- A raw legacy mouse tool is emitted or executed.
- `task.complete` happens immediately after app launch.
- No OCR map or label map is produced.
- The same bad point is clicked repeatedly after no visual change.
- There is no after screenshot.

## Debug Artifacts

Each SOC step writes best-effort artifacts under:

`~/.larund-click/soc-mode/<run-id>/step-XXX/`

Expected files include raw screenshot base64, label overlay base64, OCR JSON, label JSON, model output, execution log, after screenshot, and turn context.

## Manual Verification

Open the agent step details in the Larund Click UI. For each SOC step, verify:

- `mode` is `soc_visual`.
- OCR and label counts are non-zero when text is visible.
- `clickSource` is `ocr` or `label` for grounded clicks.
- `clicked` coordinates match the center of the selected bbox.
- `noChange` becomes true after a no-op click and the next step does not repeat that point.
