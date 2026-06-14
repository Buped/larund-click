---
name: marketing-report
description: "Compile a marketing report by reading spreadsheets/CSVs and web sources, then writing a summary file."
allowed_tools: ["sheet.read", "file.read", "file.write", "browser.open", "browser.read", "browser.extract_table", "connection.call"]
requires_connections: []
risk: "local_write"
trigger: "build a marketing report, weekly metrics summary, compile analytics into a doc"
---

# Marketing Report

Use to compile a recurring marketing/metrics report.

Workflow:
1. Gather inputs: `sheet.read` for spreadsheets/CSVs, `browser.*` for web dashboards,
   `connection.call` for any configured analytics connection.
2. Aggregate the key metrics (totals, deltas vs. previous period, highlights).
3. Write the report with `file.write` (Markdown), or `sheet.write` for a metrics tab.
4. Summarize what changed and where the report was saved.

Rules:
- Never use a mouse. Read structured data, don't screenshot dashboards.
- This is a good candidate to run on a schedule via a workflow.
