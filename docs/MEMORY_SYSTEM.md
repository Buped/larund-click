# Memory System

Structured long-term memory — **not** chat history. The user stays in control: every
entry is typed, scoped, has a confidence and provenance, and can be pinned, archived
or deleted. Code: `src/lib/memory/`.

## Model

```ts
MemoryEntry {
  id; userId; workspaceId?; projectId?;
  type: 'user_profile' | 'workspace' | 'project' | 'procedural'
      | 'episodic' | 'evidence' | 'preference' | 'correction';
  title; content; tags[];
  source: 'user' | 'agent' | 'task' | 'document' | 'correction' | 'system';
  confidence;            // 0..1 — user entries high, auto-extracted lower
  pinned; archived;
  createdAt; updatedAt; lastUsedAt?; metadata?;
}
```

## Store API (`store.ts`)

`createMemory`, `getMemory`, `updateMemory`, `archiveMemory`, `deleteMemory`,
`listMemory`, `searchMemory`, `getRelevantMemory`, `markMemoryUsed`.

Scoping rules in `listMemory`: returns the user's own entries; when a `workspaceId` is
given, includes that workspace's entries **plus** user-global (no-workspace) entries.

## Retrieval (`retriever.ts`)

Phase 1 uses **deterministic lexical scoring** (no vector DB). Score components:

- exact tag match (strongest), title overlap, content overlap
- same-workspace boost (and a small cross-workspace penalty)
- pinned boost, recency boost (uses `lastUsedAt`)
- type relevance (preferences/corrections/procedural biased up)
- confidence scaling

The interface (`scoreMemory`, `rankMemories`) is intentionally simple so an
embedding/vector backend can be slotted in behind it later.

## Prompt integration (`prompt.ts`)

Before a run, the top entries are retrieved and rendered as a compact **"Relevant
memory"** block (max 6 entries / ~1400 chars), each line tagged with its `id` so the
agent can reference memory. Surfaced entries are marked used (recency boost).

## Extraction (`extractor.ts`)

Conservative, deterministic candidate detection after a task — preferences ("I always
prefer…"), corrections ("No, that's wrong…"), repeated-procedure patterns, and verified
outcomes. Candidates carry `reviewStatus: 'pending'`; **nothing is auto-saved
aggressively** — they are meant for user review (`candidateToInput` converts approved
ones).

## UI

Coworker → **Memory** tab: add, search, filter, pin/unpin, archive, delete; shows
source, confidence and last-used.

## Existing session memory

The in-session `agent-state` task memory (active task, corrections, expected data) is
unchanged. The Memory System is the durable layer alongside it.
