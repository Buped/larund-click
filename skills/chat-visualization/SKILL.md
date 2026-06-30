---
name: chat-visualization
description: "Render a final chat-native visual (chart/diagram/dashboard) with visualization.render as self-contained static HTML/CSS/SVG in Larund dark style."
allowed_tools: ["visualization.render", "code.execute", "ask_user"]
requires_connections: []
risk: "read_only"
trigger: "chart diagram graph visualization vizualizacio grafikon abra dashboard flow map process view"
when_to_use: ["Use when the user wants a chart, diagram, visual map, dashboard snippet or visual explanation rendered in chat."]
when_not_to_use: ["Do not use when the user asked for a chart inside an Excel/XLSX file (use local-office sheet.add_chart)."]
---

# Chat Visualization

The visual is final user-facing output, NOT thinking. Never put visual HTML/SVG/chart code into the thinking/progress prose.

## Standard
- Render with `visualization.render` as self-contained, static HTML/CSS/SVG: no scripts, no forms, no external assets/fonts, no inline event handlers.
- Larund is dark-mode only. All text must be light and readable: `#f4f0ea` for primary text, `#a6aeba` for muted labels. Never use black or dark gray for titles, axis labels, ticks, captions, legends or annotations. Use a deep background, subtle borders, an orange accent, and a responsive SVG.
- Use `code.execute` only when computation/data cleaning is genuinely needed; once the data is known, render the visual with `visualization.render`, not as a Python PNG.
- For a time-series/period/trend, do not draw a two-point line: use as many data points as the sources provide. If only start and end values are known, say data is limited and design a comparison card instead of faking a trend line.
- A serious visualization includes a clear title, concise subtitle, source/date note, axis labels, readable ticks, highlighted key numbers, and one annotation explaining the main takeaway.

## Action shape (exact JSON)
{"action":"visualization.render","title":"<short title>","height":420,"html":"<self-contained static HTML/CSS/SVG, no scripts/forms/external assets>"}

## Verification
- Confirm the rendered visual carries title, labels, source/date and a takeaway; never emit visual code into progress prose.
