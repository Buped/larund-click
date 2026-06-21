# Artifact Renderers

## PDF
The PDF renderer writes:

- `source/document.json`
- an HTML source file in `output/`
- a generated PDF in `output/`
- `preview/thumbnail.png`
- `artifact.json`

The current renderer is dependency-light and local. The HTML source keeps a clean upgrade path for richer Chromium/Playwright rendering later.

## DOCX
The DOCX renderer creates an editable Office Open XML package with title, paragraphs, page breaks, and tables. It supports Hungarian text through UTF-8 XML parts.

## PPTX
The PPTX renderer creates a 16:9 presentation package from typed slide models. Verification counts slide XML files and extracts slide text.

## LibreOffice
`artifact.convert` uses LibreOffice headless mode when available. If `soffice` is missing or conversion fails, the command returns a blocker/error and does not claim success.

## Testing
Run:

```sh
npm test -- --run src/lib/artifacts/__tests__/artifacts.test.ts
npm run build
cd src-tauri && cargo check
```
