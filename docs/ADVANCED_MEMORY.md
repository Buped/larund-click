# Advanced Memory (Phase 2)

Upgrades the Memory Center from storage/search into a practical coworker memory
system with a lifecycle, a suggestion→review pipeline, and memory operations.
Code: `src/lib/memory/`.

## Lifecycle & fields

`MemoryEntry.status`: `active | suggested | needs_review | archived | rejected`.
Only **active** memory is ever used in prompts.

New fields: `scope` (`global | workspace | project | skill`), `sourceTaskRunId`,
`sourceEvidenceId`, `expiresAt`, `sensitivity` (`normal | private |
secret_reference`), `writePolicy` (`manual_only | suggest_then_confirm |
auto_low_risk`), `embeddingText` (placeholder for future vector search).

Phase 1 entries are normalized on read (no migration needed): missing `status`
derives from `archived`; missing `scope` from `workspaceId`.

## Suggestion pipeline

`generateSuggestions(task, evidence)` (`suggester.ts`) is **pure** and
conservative. After a completed task it proposes, as `suggested` (never silently
active):

1. **Preference** — from "I always prefer…" style user text.
2. **Correction** — high-priority, from corrections made during the run.
3. **Procedural** — from a repeated structured tool sequence.
4. **Project** — only when the prompt states product/project direction.
5. **Evidence** — only for *verified* outcomes with a concrete artifact.

Capped at 5 suggestions; deduped by title. It returns `CreateMemoryInput` drafts;
the caller persists with `suggestMemory` (status `suggested`).

## Review queue

`listSuggestions(userId, workspaceId?)` returns `suggested` + `needs_review`.
- `acceptMemorySuggestion(id, patch?)` → `active` (optionally edited/scoped).
- `rejectMemorySuggestion(id, remove?)` → `rejected` (or deleted).

In the UI: **Coworker → Memory → Review queue** with Accept / Reject.

## Memory operations

`supersedeMemory(old, new)`, `markContradiction(a, b)` (→ `needs_review`),
`mergeMemories(target, others)` (combines content/tags, archives others),
`detectDuplicates(userId)` (Jaccard token-overlap clusters), `pinMemory`,
`exportMemory` / `importMemory` (JSON, re-keys ids).

## Retrieval & prompt

`getRelevantMemory` retrieves **active, non-expired** entries only, scored by the
lexical retriever (corrections ranked highest, then preferences/procedural).
`renderRelevantMemory` emits provenance lines:

```
- [memory:<id> <type> <scope> <confidence>[ pinned]] <title>: <content>
```

Bounded to 6 entries / ~1400 chars.

## Tests

`memory.test.ts`, `memory-advanced.test.ts`: suggestion extraction, duplicate
detection, scope filtering, archived/rejected excluded from prompts, correction
ranking, lifecycle transitions, merge/supersede/contradiction, export/import.

## Safety / limitations

- Local-first (shared `coworker_kv` SQLite); no cloud sync.
- Retrieval is lexical — `embeddingText` is a placeholder; no vector search yet.
- Suggestions require explicit user acceptance; nothing auto-activates.
