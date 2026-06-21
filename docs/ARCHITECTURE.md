# Larund Click — Architecture

Larund Click is a **local-first, no-mouse AI operator**. It performs structured
digital work through CLI, files, browser DOM automation, apps, connections,
skills and workflows — never by controlling a mouse or cursor.

## Layers

```
                ┌────────────────────────────────────────────┐
   user task →  │  control-system/loop.ts  (agent loop)       │
                │   model → parser → guarded runner            │
                └───────────────┬──────────────────────────────┘
                                │
   prompt.ts ──────────────────┤   one JSON action per turn
   parser.ts  (allow-list)     │
                                ▼
                ┌────────────────────────────────────────────┐
                │  tools/run.ts  (policy → approval → audit)   │
                └───────────────┬──────────────────────────────┘
                                ▼
                ┌────────────────────────────────────────────┐
                │  control-system/executor.ts  (dispatcher)    │
                │   cli/file/sheet/clipboard/app/keyboard/     │
                │   browser  → Tauri commands (Rust)           │
                │   connection.call → connections/registry     │
                │   skill.run       → skills/runner            │
                │   workflow.*      → workflows/runner         │
                └────────────────────────────────────────────┘
```

## Modules

- **`src/lib/control-system`** — the agent core: `types.ts` (the closed
  `ControlAction` union), `parser.ts` (strict allow-list + legacy-visual guard),
  `prompt.ts` (no-mouse system prompt), `executor.ts` (pure dispatcher),
  `loop.ts` (the run loop).
- **`src/lib/tools`** — `registry.ts` (tool catalog), `policy.ts` (risk
  assessment + decisions), `approvals.ts`, `audit.ts`, `run.ts` (the single
  gated entry point).
- **`src/lib/skills`** — `SKILL.md` frontmatter parser, loader (precedence),
  runner. Bundled skills live in `/skills`.
- **`src/lib/connections`** — OpenClaw-style connection registry + provider
  manifests (`github`, `notion`, `google-workspace`, `slack`, …) + secrets.
- **`src/lib/workflows`** — engine, store and runner for long-running tasks.
- **`src-tauri/src/commands`** — Rust commands: `agent.rs` (shell/file/sheet/
  clipboard/app/keyboard), `fs_ops.rs` (mkdir/copy/move/delete/search/tree/…),
  `process.rs` (background processes), `browser.rs` (CDP/DOM).

## Reference model

The design follows OpenClaw architecturally (gateway / agent runtime / tools /
skills / connections / workflows / approvals / audit) rather than copying code.
See [ROADMAP_OPENCLAW_STYLE.md](ROADMAP_OPENCLAW_STYLE.md).
## Skill Runtime Layer

The operator loop builds coworker context, routes skills with `src/lib/skills/router.ts`, preloads the primary skill when confidence is high, and adds `task-verification` for write/external work. `skill.run` returns structured runtime context. `src/lib/tools/run.ts` enforces active-skill allowed tools, and `src/lib/control-system/completion-guard.ts` blocks completion until read-back evidence satisfies active skill verification. See `docs/SKILL_ENGINE_V2.md`.
