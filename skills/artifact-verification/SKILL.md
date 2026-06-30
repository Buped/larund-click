---
name: artifact-verification
description: "Verify local artifact files before completion: existence, readability, expected text, counts, preview, and manifest."
allowed_tools: ["artifact.verify", "artifact.preview", "artifact.list", "artifact.pdf_extract_text", "artifact.pdf_metadata", "artifact.pdf_page_count", "file.exists", "file.metadata"]
requires_connections: []
risk: "read_only"
trigger: "artifact verify ellenoriz ellenőriz preview thumbnail manifest page count slide count"
---

# Artifact Verification
Use this skill after every artifact render and before `task.complete`.

## Checklist
1. File exists and size is greater than zero.
2. File is readable by `artifact.verify`.
3. Page count or slide count is present when relevant.
4. Expected text is checked when the user provided concrete content.
5. Preview/thumbnail exists when generated.
6. Manifest appears in `artifact.list`.

## Action shapes (exact JSON)
{"action":"artifact.verify","path":"<path>","expected_text":["<text>"],"expected_kind":"pdf"}
{"action":"artifact.preview","path":"<path>","pages":[1]}
{"action":"artifact.list","workspace_id":"<optional>","task_id":"<optional>"}
{"action":"artifact.pdf_extract_text","path":"<pdf>"}
{"action":"artifact.pdf_metadata","path":"<pdf>"}
{"action":"artifact.pdf_page_count","path":"<pdf>"}
