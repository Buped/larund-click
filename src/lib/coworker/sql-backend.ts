// SQLite-backed RecordBackend, layered on the existing Tauri SQL database.
//
// All coworker documents live in one generic key/value table keyed by
// (collection, id) with a JSON `data` column. This mirrors the in-memory backend
// exactly, so production and tests behave identically. Call
// `installSqlCoworkerBackend()` once after `initDatabase(userId)`.

import { getDb } from '../database';
import { InMemoryBackend, setRecordBackend, type RecordBackend, type RecordRow } from './persistence';

const TABLE = 'coworker_kv';

class SqlBackend implements RecordBackend {
  async all(collection: string): Promise<RecordRow[]> {
    const db = await getDb();
    const rows = await db.select<Array<{ data: string }>>(
      `SELECT data FROM ${TABLE} WHERE collection = ? ORDER BY id ASC`,
      [collection],
    );
    return rows.map((r) => JSON.parse(r.data) as RecordRow);
  }

  async get(collection: string, id: string): Promise<RecordRow | null> {
    const db = await getDb();
    const rows = await db.select<Array<{ data: string }>>(
      `SELECT data FROM ${TABLE} WHERE collection = ? AND id = ?`,
      [collection, id],
    );
    return rows[0] ? (JSON.parse(rows[0].data) as RecordRow) : null;
  }

  async put(collection: string, row: RecordRow): Promise<void> {
    const db = await getDb();
    await db.execute(
      `INSERT INTO ${TABLE} (collection, id, data, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(collection, id) DO UPDATE SET
         data = excluded.data,
         updated_at = excluded.updated_at`,
      [collection, row.id, JSON.stringify(row)],
    );
  }

  async delete(collection: string, id: string): Promise<void> {
    const db = await getDb();
    await db.execute(`DELETE FROM ${TABLE} WHERE collection = ? AND id = ?`, [collection, id]);
  }
}

let installed = false;

/**
 * Create the coworker_kv table and install the SQLite backend. Idempotent.
 * On any failure (e.g. running outside Tauri) it falls back to in-memory so the
 * app never hard-crashes on storage init.
 */
export async function installSqlCoworkerBackend(): Promise<void> {
  if (installed) return;
  try {
    const db = await getDb();
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (collection, id)
      )
    `);
    setRecordBackend(new SqlBackend());
    installed = true;
  } catch (err) {
    console.warn('Coworker SQL backend unavailable, using in-memory store:', err);
    setRecordBackend(new InMemoryBackend());
  }
}
