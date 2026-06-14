# Unified Control System Benchmark

## Scenario

Task:

> Nyisd meg a Robloxot es lepj be a Ground War nevu jatekba eger segitsegevel.

## Expected Trace

1. Detect the task as a native visual desktop task and run it through `control-system`.
2. Open Roblox with `desktop_open_app` or another verified deterministic app-launch path.
3. Capture a raw, unannotated screenshot with exact coordinate metadata.
4. Build a `ScreenObservation` from UIA, OCR lines, OCR card candidates, and optional grid VLM grounding.
5. Build a coarse 40 px visual grid and write a debug overlay.
6. Resolve `Ground War` to a real `TargetCandidate` or a coarse grid cell.
7. Crop around the chosen coarse cell, build a 10 px fine grid, and choose only a fine cell/region.
8. Compute the click pixel in code from the final bbox/cell center.
9. Reject large containers, whitespace, off-screen bboxes, low confidence, and repeated failed points.
10. Convert the target into a `VerifiedMouseTarget`.
11. Execute only `mouse_click_verified`; raw point-click and legacy visual-target tools are invalid for this flow.
12. Capture an after screenshot and verification metadata.
13. Complete only after visual/state evidence shows the Roblox detail page, Play button, loading/joining, or game session.

## Fails If

- Completion happens immediately after app launch.
- Solitaire or another unrelated app opens.
- Any visual desktop task calls a raw mouse, drag, point-click, or legacy visual-target action.
- A visual action runs without a fresh screenshot.
- The click point is outside the selected bbox.
- The planner supplies absolute pixels instead of `visual.clickIntent` or `visual.typeIntent`.
- The same or nearby failed coordinate is repeated after no visual/state change.
- No before/after screenshot is captured.
- No target bbox, label, confidence, source, click point, expectation, or verification result is recorded.

## Debug Artifacts

Artifacts are written under:

```text
~/.larund-click/control-system/<run-id>/step-XXX/
```

Each step should include:

- `before-observation.json`, `before-screenshot.b64`, and `coarse-overlay.b64`
- `local-candidates.json`, `coarse-grounding.json`, `fine-grounding.json`
- `selected-target.json`
- `after-observation.json` and `after-screenshot.b64`
- `verification.json`

The planner screenshot stays raw. Helper overlays are debug artifacts only.
