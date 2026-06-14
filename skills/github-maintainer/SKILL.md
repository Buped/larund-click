---
name: github-maintainer
description: "Maintain GitHub repos via the GitHub connection: read files, list/comment issues, create branches and open PRs."
allowed_tools: ["connection.call", "approval.request", "ask_user"]
requires_connections: ["github"]
risk: "external_write"
trigger: "read a GitHub repo, summarize a README, open a PR, comment on an issue"
---

# GitHub Maintainer

Use for GitHub repository work. Requires the `github` connection to be configured.

Workflow:
1. If the connection is not configured, `ask_user` to set up the GitHub token.
2. Read with `connection.call` (`github.read_file`, `github.list_issues`, `github.search_repos`).
3. Summarize or analyze the results for the user.
4. For any write (`github.write_file`, `github.create_branch`, `github.open_pr`,
   `github.comment_issue`), use `approval.request` first — these are external_write.
5. Report the created PR/branch/comment URL at the end.

Rules:
- Never use a mouse. All GitHub work goes through the connection tools.
- Reads auto-run; writes/comments/PRs always require approval.
