# Artifact Skills

Bundled artifact skills:

- `artifact-pdf-document`
- `artifact-presentation`
- `artifact-word-document`
- `artifact-invoice`
- `artifact-business-report`
- `artifact-proposal`
- `artifact-verification`

These skills route document-like requests away from `file.write` and toward structured models, local renderers, previews, and verification.

## Common Flow
1. Read referenced inputs.
2. Run `artifact.plan`.
3. Build the source model.
4. Render the requested format.
5. Verify output.
6. Complete only after verification succeeds.

Invoice workflows must ask for missing legal-critical data or mark outputs as `TESZT/MINTA`.
