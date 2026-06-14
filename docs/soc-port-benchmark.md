# SOC Port Benchmark

## Required Notepad Regression

Task:

```text
Nyisd meg a Jegyzettombot.
Ird bele:

ALMA
KORTE
BANAN
SZILVA

Ezutan kattints pontosan a "BANAN" sor kozepere.
Utana irj moge egy szokozt es ezt:
SIKERES
```

Expected final visible text:

```text
ALMA
KORTE
BANAN SIKERES
SZILVA
```

This benchmark fails if only `SIKERES` appears, if the text is inserted on the wrong row, if newline input is flattened, or if `done` is accepted while OCR does not contain the expected final text.

## Expected SOC Trace

1. Deterministic route may open Notepad and type the initial multiline text.
2. Visual cursor route is `soc.visual`.
3. SOC mode defaults to OCR.
4. The model emits Self-Operating Computer operation names only: `click`, `write`, `press`, `done`.
5. OCR click uses `{"operation":"click","text":"BANAN"}`.
6. The executor resolves OCR text by substring match first, split-word grouping second.
7. The click metadata uses the original OCR bbox, not a synthetic 6x6 bbox.
8. The full model JSON array executes in order.
9. After actions, SOC captures a fresh screenshot.
10. `done` is accepted only when expected OCR text is visible for explicit expected-text tasks.

## Roblox Smoke

Task:

```text
Nyisd meg a Robloxot es lepj be a Ground War nevu jatekba eger segitsegevel.
```

Expected trace:

1. `app.open` launches Roblox.
2. The control loop automatically emits `soc.visual` with `mandatory_after_gui_app_launch`.
3. SOC observes screenshot/OCR.
4. OCR mode emits `click` + `text`, or standard mode emits `click` + percent coordinates.
5. No removed Larund visual stack is used.
