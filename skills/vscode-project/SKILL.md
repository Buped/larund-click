---
name: vscode-project
description: "Open projects in VS Code from the CLI, edit files, run tests and read git diffs — keyboard/CLI only, no mouse."
allowed_tools: ["app.open", "cli.run", "file.read", "file.write", "file.edit", "file.tree", "file.search", "keyboard.combo"]
requires_connections: []
risk: "process_exec"
trigger: "open a project in VS Code, run tests, fix failing tests, read git diff"
---

# VS Code Project Workflow

Use for coding workflows on a local project.

Workflow:
1. Open the project: `cli.run` `code --reuse-window <folder>` (or `app.open` VS Code).
2. Jump to a file/line with `code <file>:<line>` when useful.
3. Scan the project with `file.tree` / `file.search`.
4. Edit files with `file.edit` / `file.write` (deterministic, not by clicking).
5. Run tests/build via `cli.run` (e.g. `npm test`, `cargo test`).
6. Read changes with `cli.run` `git diff`.
7. If an action only exists as a GUI menu click with no command/CLI/shortcut, `ask_user`.

Rules:
- Never click inside VS Code. Use CLI, file tools, and deterministic shortcuts only.
- Use a known command-palette keyboard shortcut only when it is deterministic.
