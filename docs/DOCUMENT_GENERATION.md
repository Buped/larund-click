# Document Generation

Document requests should not be completed with plain `.txt` unless the user explicitly asks for text. For PDF, DOCX, PPTX, reports, proposals, invoices, one-pagers, and downloadable documents, use artifact tools.

## Format Rules
- PDF/report/invoice/proposal/beautiful document: `artifact.render_pdf`
- Word/DOCX/editable/contract: `artifact.render_docx`
- Presentation/deck/slides/PPTX: `artifact.render_pptx`
- Excel/table/XLSX/CSV: existing `sheet.write` tools
- Google Docs/Sheets: Google Workspace connection or browser tools, not local artifacts

## Models
PDF and DOCX use `DocumentArtifactModel`: title, language, page settings, brand, sections, tables, charts, assets, and footer.

PPTX uses `PresentationArtifactModel`: title, language, aspect ratio, brand, and typed slides.

## Verification
Every generated artifact must be checked with `artifact.verify` before `task.complete`. For concrete user content, pass `expected_text`. For requested slide counts, verify the resulting `slideCount`.
