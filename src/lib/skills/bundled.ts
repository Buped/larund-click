// Bundled skills. Kept inline (not `?raw`) so the runtime and the test runner
// have a single, dependency-free source of truth. The matching human-facing
// SKILL.md files live under /skills and document the same workflows.

const fileOrganizer = `---
name: file-organizer
description: "Organize, rename, sort and restructure local files using deterministic file tools with previews and approvals."
allowed_tools: ["file.list", "file.tree", "file.search", "file.mkdir", "file.move", "file.copy", "file.delete", "approval.request"]
requires_connections: []
risk: "local_write"
trigger: "organize sort clean rename restructure files folders downloads projects"
---

# File Organizer
1. Inspect with file.list / file.tree.
2. Classify into categories.
3. Propose a plan; stop here if a dry-run was requested.
4. Ask approval before moving or deleting many files.
5. Execute file.mkdir then file.move/copy. Never delete without approval.
6. Summarize all changes.`;

const browserAutomation = `---
name: browser-automation
description: "Drive websites via the browser DOM/CDP tools (read/click/type/extract) — never the mouse or screen pixels."
allowed_tools: ["browser.open", "browser.read", "browser.click", "browser.type", "browser.key", "browser.wait", "browser.extract_table", "browser.download", "browser.upload", "ask_user"]
requires_connections: []
risk: "external_write"
trigger: "open website fill form extract data log into web app browser"
---

# Browser Automation
1. browser.open the page. 2. browser.read to snapshot DOM.
3. Act by element text/selector. 4. Re-read after UI changes.
5. extract_table for tables. 6. login/2FA/captcha -> ask_user. Never use a mouse.`;

const vscodeProject = `---
name: vscode-project
description: "Open projects in VS Code from the CLI, edit files, run tests and read git diffs — keyboard/CLI only, no mouse."
allowed_tools: ["app.open", "cli.run", "file.read", "file.write", "file.edit", "file.tree", "file.search", "keyboard.combo"]
requires_connections: []
risk: "process_exec"
trigger: "open project vs code run tests fix failing tests git diff coding"
---

# VS Code Project Workflow
1. code --reuse-window <folder>. 2. file.tree/search to scan.
3. Edit with file.edit/write. 4. cli.run tests/build. 5. git diff. Never click in VS Code.`;

const githubMaintainer = `---
name: github-maintainer
description: "Maintain GitHub repos via the GitHub connection: read files, list/comment issues, create branches and open PRs."
allowed_tools: ["connection.call", "approval.request", "ask_user"]
requires_connections: ["github"]
risk: "external_write"
trigger: "github repo readme pull request issue branch commit"
---

# GitHub Maintainer
1. If github not configured, ask_user. 2. Read via connection.call (read_file/list_issues/search_repos).
3. Writes (write_file/open_pr/comment_issue) need approval.request. 4. Report URLs.`;

const notionWorkspace = `---
name: notion-workspace
description: "Read and write Notion pages and databases via the Notion connection, with approval for writes."
allowed_tools: ["connection.call", "approval.request", "ask_user"]
requires_connections: ["notion"]
risk: "external_write"
trigger: "notion page database row update create query workspace"
---

# Notion Workspace
1. If notion not configured, ask_user. 2. Read via search/read_page/query_database.
3. Writes (create_page/update_page/create_database_row) need approval. 4. Report page URL.`;

const marketingReport = `---
name: marketing-report
description: "Compile a marketing report by reading spreadsheets/CSVs and web sources, then writing a summary file."
allowed_tools: ["sheet.read", "file.read", "file.write", "browser.open", "browser.read", "browser.extract_table", "connection.call"]
requires_connections: []
risk: "local_write"
trigger: "marketing report weekly metrics summary analytics dashboard compile"
---

# Marketing Report
1. Gather inputs (sheet.read, browser.*, connection.call).
2. Aggregate key metrics + deltas. 3. file.write the report (Markdown).
4. Summarize what changed and where it was saved. Never screenshot dashboards.`;

export const BUNDLED_SKILL_FILES: string[] = [
  fileOrganizer,
  browserAutomation,
  vscodeProject,
  githubMaintainer,
  notionWorkspace,
  marketingReport,
];
