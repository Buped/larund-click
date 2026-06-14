# Roadmap — OpenClaw-style operator

Larund Click adopts OpenClaw's architecture (not its code): tools + skills +
connections + workflows + approvals + audit, with a no-mouse runtime.

## Done

- No-mouse core; legacy visual/SOC removed and guarded by tests.
- Tool registry, risk policy, approval engine, redacting audit log.
- Expanded filesystem (mkdir/copy/move/delete/search/tree/exists/metadata) +
  background process management.
- Browser DOM tools (CDP) as the GUI replacement.
- Skills system with `SKILL.md` frontmatter, precedence, 6 bundled skills.
- Connection registry: GitHub + Notion MVP (real + mock), Google/Slack/HubSpot/
  Airtable/WordPress scaffolds.
- Workflow engine with state, waiting/resume, cancel, revision checks.
- Operator UI surface (Connections / Skills / Workflows / Tool catalog).

## Next

1. **Tool search** — when the catalog grows, let the model pick a category, then
   fetch detailed schemas (avoid sending every schema each turn).
2. **Persistent stores** — workflows + audit to `~/.larund/`.
3. **OAuth** — Google Workspace + Slack real auth; encrypted secret store via a
   Tauri plugin.
4. **Connection completeness** — flesh out HubSpot/Airtable/WordPress.
5. **Skill creator** — a `skill-creator` skill that proposes new `SKILL.md`
   files (write only after approval).
6. **Onboarding** — workspace root, model, tool/approval policy, connection
   setup, sample test run; CLI: `larund onboard|doctor|connections|skills|run`.
7. **Managed browser profile** — isolated agent profile by default; user profile
   only on explicit request for login.
8. **Native cleanup** — delete the now-unreachable Rust mouse/screenshot/SOC/UIA
   commands.
