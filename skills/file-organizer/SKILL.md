---
name: file-organizer
description: "Organize, rename, sort and restructure local files using deterministic file tools with previews and approvals."
allowed_tools: ["file.list", "file.tree", "file.search", "file.mkdir", "file.move", "file.copy", "file.delete", "approval.request"]
requires_connections: []
risk: "local_write"
trigger: "organize, sort, clean up, rename, restructure files or folders (Downloads, projects)"
---

# File Organizer

Use when the user asks to organize, rename, sort, or restructure local files.

Workflow:
1. Inspect the target with `file.list` / `file.tree` (and `file.search` if needed).
2. Classify items into categories (documents, images, invoices, projects, …).
3. Propose a concrete plan (which files move where, which folders to create).
4. If the user asked for a dry-run / plan first, stop here and report the plan.
5. Ask approval (`approval.request`) before moving or deleting many files.
6. Execute deterministic operations: `file.mkdir`, then `file.move` / `file.copy`.
7. Never delete without explicit approval. Summarize all changes at the end.

Rules:
- Never use a mouse. All file operations go through the structured file tools.
- Prefer move over copy+delete. Show a before/after summary.
