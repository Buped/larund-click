// Shared persistence layer for the Larund Coworker Core (Phase 1).
//
// Every coworker domain store (workspaces, memory, tasks, evidence, connection
// instances, workspace-skill state) persists JSON documents through this single
// abstraction. The default backend is in-memory so the pure logic and stores are
// fully unit-testable under Node/Vitest without Tauri. In the real app we install
// the SQLite backend (see `sql-backend.ts`) after the database is initialized.
//
// Documents are stored opaquely as JSON keyed by `id`; filtering/querying happens
// in JS. This is intentional: Larund is local-first and single-user, so the row
// counts are small and a uniform document store keeps every domain trivial and
// consistent. A future migration to indexed columns or a vector store can replace
// a single backend implementation without touching any domain store.

export interface RecordRow {
  id: string;
  [key: string]: unknown;
}

export interface RecordBackend {
  all(table: string): Promise<RecordRow[]>;
  get(table: string, id: string): Promise<RecordRow | null>;
  put(table: string, row: RecordRow): Promise<void>;
  delete(table: string, id: string): Promise<void>;
}

/** In-memory backend. Default everywhere; the only backend used in tests. */
export class InMemoryBackend implements RecordBackend {
  private tables = new Map<string, Map<string, RecordRow>>();

  private table(name: string): Map<string, RecordRow> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  async all(table: string): Promise<RecordRow[]> {
    return [...this.table(table).values()].map((r) => structuredCloneSafe(r));
  }

  async get(table: string, id: string): Promise<RecordRow | null> {
    const r = this.table(table).get(id);
    return r ? structuredCloneSafe(r) : null;
  }

  async put(table: string, row: RecordRow): Promise<void> {
    this.table(table).set(row.id, structuredCloneSafe(row));
  }

  async delete(table: string, id: string): Promise<void> {
    this.table(table).delete(id);
  }

  /** Test helper: wipe everything. */
  reset(): void {
    this.tables.clear();
  }
}

function structuredCloneSafe<T>(value: T): T {
  // structuredClone is available in Node 18+ and modern browsers, but guard for
  // exotic runtimes by falling back to JSON round-tripping.
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

// ── Active backend wiring ───────────────────────────────────────────────────

let activeBackend: RecordBackend = new InMemoryBackend();

/** Install a backend (e.g. the SQLite adapter) for the running app. */
export function setRecordBackend(backend: RecordBackend): void {
  activeBackend = backend;
}

/** The currently installed backend. Stores call this lazily on every op so a
 *  late `setRecordBackend` (after DB init) is picked up transparently. */
export function recordBackend(): RecordBackend {
  return activeBackend;
}

/** Reset to a fresh in-memory backend. Test-only convenience. */
export function resetRecordBackendForTests(): RecordBackend {
  const backend = new InMemoryBackend();
  activeBackend = backend;
  return backend;
}
