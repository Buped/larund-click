# Artifact Engine

Larund artifacts are first-class local outputs for generated documents and exports. The engine keeps a structured source model, rendered files, previews, logs, verification data, and a manifest together in one local artifact folder.

## Lifecycle
1. `artifact.plan` detects the requested format and template.
2. The agent builds a structured `DocumentArtifactModel` or `PresentationArtifactModel`.
3. `artifact.render_pdf`, `artifact.render_docx`, or `artifact.render_pptx` writes the source model and output file.
4. A thumbnail preview is generated.
5. `artifact.verify` checks existence, readability, counts, and expected text.
6. `artifact.json` is saved and shown back to the chat layer as file-card data.

## Current Backends
- PDF: local structured model to HTML source plus generated PDF.
- DOCX: editable Word package with paragraphs, page breaks, and tables.
- PPTX: local presentation package with one XML slide per model slide.
- Conversion: LibreOffice headless fallback when installed.

Advanced PDF merge/split/watermark actions are registered. Split and multi-PDF merge currently return explicit blockers rather than fake success.
