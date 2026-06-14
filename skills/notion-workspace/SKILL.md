---
name: notion-workspace
description: "Read and write Notion pages and databases via the Notion connection, with approval for writes."
allowed_tools: ["connection.call", "approval.request", "ask_user"]
requires_connections: ["notion"]
risk: "external_write"
trigger: "create a Notion page, query a Notion database, add a row, update a page"
---

# Notion Workspace

Use for Notion work. Requires the `notion` connection.

Workflow:
1. If Notion is not configured, `ask_user` to set up the Notion API key.
2. Search/read with `connection.call` (`notion.search`, `notion.read_page`, `notion.query_database`).
3. For writes (`notion.create_page`, `notion.update_page`, `notion.create_database_row`,
   `notion.update_database_row`), use `approval.request` first.
4. Report the created/updated page URL.

Rules:
- Never use a mouse. All Notion work goes through the connection tools.
- Writes default to requiring approval.
