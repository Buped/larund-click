---
name: file-organizer
description: "Organize, rename, sort and restructure local files using deterministic file tools with previews and approvals."
allowed_tools: ["file.list", "file.tree", "file.search", "file.mkdir", "file.move", "file.copy", "file.delete", "file.exists", "file.metadata", "doc.write_txt", "approval.request"]
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

## Downloads & file organization safety
- After a `browser.download`, the result gives the saved path. ALWAYS `file.exists` (or `file.metadata`) to confirm the file is really there, then `file.move`/`file.copy` it to the requested folder with a meaningful name (date + vendor/subject). Verify again after moving.
- When sorting/organizing, NEVER delete. Use `file.copy` or `file.move` only. If a file's type/destination is uncertain, move it to a "Review" subfolder instead of guessing, and note it. Only `file.delete` with explicit approval.
- For duplicates, do not overwrite: append a numeric/date suffix to the filename.
- Always end an organization task with `file.tree`/`file.list` to prove the final layout, and write a short operation log (what moved where, what went to Review) with `doc.write_txt`.
