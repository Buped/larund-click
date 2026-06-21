# Skill Engine v2

Larund skills are runtime capability packages, not only UI cards. A skill can declare when to use it, when not to use it, allowed tools, required connections/MCP servers, risk, workflow instructions, and verification checks.

## Runtime Flow

1. The coworker context loads bundled plus enabled custom/workspace skills.
2. `routeSkills` scores the task using trigger phrases, names, categories, descriptions, when-to-use/when-not-to-use text, Hungarian/English synonyms, references, current surface, required tools, required connections, risk, history, and explicit `@skill` mentions.
3. If the primary route has confidence >= 60%, the control loop runs `skill.run` before the first model action.
4. For write/external work, `task-verification` is also loaded.
5. `skill.run` returns an Active Skill block plus structured runtime context: allowed tools, required connections, risk, full body, and verification checklist.
6. The tool runner blocks actions outside the active skill allowed-tool union, except control actions such as `skill.run`, `ask_user`, `approval.request`, and `task.complete`.
7. The completion guard rejects `task.complete` when a skill was only loaded, when read-back evidence is missing, or when missing requirements remain.

## Package Format

Each package uses `SKILL.md` as the operative instruction body. Optional `larund.json` can add machine-readable metadata for indexing, UI, import review, origin tracking, and versioning.

Supported frontmatter includes:

- `name`, `description`, `version`, `author`, `license`
- `categories`, `category`, `tags`
- `trigger`, `trigger_phrases`
- `when_to_use`, `when_not_to_use`
- `allowed_tools`, `requires_connections`, `required_connections`, `required_mcp_servers`
- `risk`
- `verification_checklist`
- `status`
- `origin_repo`, `origin_path`, `origin`
- `enabled_by_default`, `supports_automation`, `supports_manual_run`
- nested `metadata`

Statuses: `pending_review`, `reviewed`, `enabled`, `disabled`, `blocked`, `deprecated`.

## Bundled Catalog

The built-in catalog now includes the original skills plus a generated Larund-compatible batch covering files/documents, Google Workspace, browser/web, GitHub/engineering, marketing/business, product/ops, and meta/safety workflows. Generated bundled skills live in `src/lib/skills/generated-bundled.ts` and are exposed through the same loader as hand-written bundled skills.

## Verification

Skill verification is enforced in addition to general task verification. A loaded skill does not count as task work. Write/external skills require read-back evidence from the matching surface: local files/sheets/docs, browser DOM assertions, or provider/API reads.
