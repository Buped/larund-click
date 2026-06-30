---
name: data-analysis-and-code
description: "Run real computation on company data with isolated Python (pandas/numpy/matplotlib): statistics, correlation, trend/regression, outlier & anomaly detection, custom multi-step transforms, chart generation, bulk text/regex processing, and programmatic mapping of an existing Excel/Doc structure."
allowed_tools: ["code.execute", "code.install_package", "sheet.read", "sheet.profile", "sheet.query", "sheet.write", "sheet.format_range", "sheet.add_chart", "document.read", "file.read", "file.write", "ask_user", "task.complete"]
requires_connections: []
risk: "process_exec"
trigger: "elemzés statisztika diagram grafikon python kód korreláció regresszió trend szórás eloszlás kiugró anomália outlier analysis statistics correlation regression deviation distribution chart plot scatter histogram percentile anomaly"
when_not_to_use: ["egyszerű összeg vagy összesítés", "simple sum or total use sheet.query", "mennyi az összesen", "egy oszlop összege"]
---

# Data Analysis & Code Execution

Use this skill when the user needs a REAL computation/analysis/transformation on their
data that the native sheet tools cannot express — statistical analysis, correlation,
trend/regression, outlier/anomaly detection, a custom multi-step transform, a generated
chart, bulk text processing with regex, simple statistical tests, or programmatically
mapping the structure of an existing Excel/Doc.

## Decision guide — pick the cheapest tool that answers the question
1. SIMPLE summary / filter / group over a table ("mennyi az összes X", "per-region
   total")? Use `sheet.query` FIRST — it is faster, exact, and needs no code run. Do
   NOT spin up Python for a plain sum/average/count that `sheet.query` already computes.
2. More than that — statistics, correlation, trend/regression, std-dev, outlier/anomaly
   detection, a custom multi-step transform, or a chart? Use `code.execute` with
   pandas/numpy/matplotlib.
3. LARGE table (>1000 rows): do NOT load the raw rows into your own context first. Pass
   the input by reference and write Python that reads the file itself
   (`pandas.read_csv`/`read_excel` on the input's file name) and returns ONLY the result
   — a number, a small table, or a saved chart — never the raw data.
4. Charts: save the figure as a PNG into the run directory (`plt.savefig("chart.png")`);
   it is harvested and shown inline in chat. Never return a long inline base64 string.
5. Final goal is a formatted Word/Excel/PPTX? Python does the COMPUTATION only; hand the
   result to `sheet.write`/`sheet.format_range` (Excel) or the `artifact.render_*` engine
   (Word/PPTX). NEVER write the polished .xlsx/.docx/.pptx directly from Python — Larund
   already has a unified, design-token-driven engine. The openpyxl/python-docx/python-pptx
   libraries in the venv are for READING/inspecting existing files, not for producing the
   final artifact.
6. Always explain in plain language what the code did and what the result means BEFORE the
   raw code/output — the code itself is a collapsible "details" section, not the main answer.

## Packages
Pre-approved (auto-provisioned into the Larund venv): pandas, numpy, openpyxl, matplotlib,
python-docx, python-pptx, PyMuPDF (`fitz`). Anything else is NOT installed silently — call
`code.install_package` (one package, approval-gated) and explain why it is needed.

## Isolation
The code runs in a throwaway sandbox folder. It cannot read/write outside that folder except
the input files you reference (they are copied in by file name). Network access is OFF unless
explicitly enabled, and enabling it always requires approval.

## Large spreadsheets — profile & query, don't dump raw rows
- Never pull thousands of raw rows into context. If a file has more than ~200 rows, do NOT read it all.
- FIRST call `sheet.profile` to learn the shape: per-column type, null ratio, unique count, numeric min/max/mean/sum, top text values, and a small representative sample.
- For any "how much / how many / total / average / per X" question, use `sheet.query` with an aggregate (sum|avg|count|min|max|count_distinct), optional filter, and optional group_by — it returns the exact computed result, never an estimate.
- Only fall back to `sheet.read` (small `max_rows`) when you genuinely need a few concrete raw rows, after profiling.

## Action shapes (exact JSON)
{"action":"sheet.profile","path":"<LOCAL .xlsx/.csv path>","sheet":"<optional>"}
{"action":"sheet.query","path":"<LOCAL .xlsx/.csv path>","sheet":"<optional>","filter":{"match":"all","conditions":[{"column":"Quarter","op":"eq","value":"Q2"}]},"aggregate":[{"op":"sum","column":"Amount"}],"group_by":["Region"],"limit":<optional>}
{"action":"code.execute","code":"<python source>","input_refs":["<ref id or file path>"],"timeout_secs":45,"allow_network":false,"label":"<short human label>"}
{"action":"code.install_package","package":"<pip package>","reason":"<why this non-allowlisted package is needed>"}

## Verification
- For a numeric/statistical answer, state the concrete computed value(s).
- For a chart, confirm the PNG was generated (it appears inline in chat).
- If the goal was an Excel/Word/PPTX deliverable, verify it was produced by the native
  sheet/artifact engine — not by Python directly.
