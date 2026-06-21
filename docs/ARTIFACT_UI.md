# Artifact UI

Generated artifacts are promoted from tool results into chat-level attachments. The action timeline remains available for debugging, but users should find documents from the assistant message itself.

## Chat Attachments

Assistant messages persist artifact cards in `messages.artifacts_json`. Each attachment stores the artifact id, file type, file name, counts, verification status, thumbnail reference, and local output path for the Details section.

Render results from `artifact.render_pdf`, `artifact.render_docx`, and `artifact.render_pptx` are mapped from `ArtifactManifest` to `ChatArtifactAttachment` and auto-open the preview rail.

## Preview Rail

The right-side rail opens when an artifact is ready. It uses controlled Tauri commands to read artifact bytes by manifest id. Raw `file://` URLs are not injected into the webview.

Supported viewers:

- PDF: in-app Blob URL preview.
- DOCX: extracted text preview with full-fidelity external open.
- PPTX: thumbnail/text fallback with full-fidelity external open.
- CSV/XLSX: simple table/text fallback where extractable.

## Actions

Cards and rail header support:

- Preview
- Open
- Save copy
- Show in folder
- Details

Save copy uses the native save dialog. Open, Show in folder, and file-byte reads resolve the artifact through its manifest and only allow files inside Larund artifact storage.

## Artifacts Page

The Artifacts nav route lists manifests from `artifact.list`, supports search/type filters, and reuses the same card and preview rail components as chat.
