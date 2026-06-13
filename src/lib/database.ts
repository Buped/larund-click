import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;
let currentUserId: string | null = null;

export async function initDatabase(userId: string): Promise<void> {
  if (db && currentUserId === userId) return;
  if (db) { await db.close(); db = null; }
  currentUserId = userId;
  const dbName = `sqlite:larund_${userId.slice(0, 8)}.db`;
  db = await Database.load(dbName);
  await initSchema(db);
}

export async function getDb(): Promise<Database> {
  if (!db) throw new Error('Database not initialized. Call initDatabase(userId) first.');
  return db;
}

async function initSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      default_model TEXT DEFAULT 'core',
      autonomy_mode TEXT DEFAULT 'semi',
      theme TEXT DEFAULT 'dark',
      dark_variant TEXT DEFAULT 'warm',
      launch_at_login INTEGER DEFAULT 0,
      minimize_to_tray INTEGER DEFAULT 1,
      show_monitor_border INTEGER DEFAULT 1,
      custom_cursor INTEGER DEFAULT 0,
      custom_instructions TEXT DEFAULT '',
      custom_openrouter_key TEXT DEFAULT '',
      memory_enabled INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      icon TEXT DEFAULT 'message',
      color TEXT DEFAULT '#8A8783',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      is_archived INTEGER DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await ensureColumn(db, 'messages', 'message_type', "TEXT DEFAULT 'text'");
  await ensureColumn(db, 'messages', 'agent_status', 'TEXT DEFAULT NULL');
  await ensureColumn(db, 'messages', 'agent_steps_json', 'TEXT DEFAULT NULL');
  await ensureColumn(db, 'messages', 'agent_ask_question', 'TEXT DEFAULT NULL');

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS my_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      app_type TEXT NOT NULL DEFAULT 'web',
      url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      usage_notes TEXT DEFAULT '',
      credential_email TEXT DEFAULT '',
      credential_password TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      full_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      role TEXT DEFAULT '',
      company TEXT DEFAULT '',
      project_description TEXT DEFAULT '',
      target_market TEXT DEFAULT '',
      communication_style TEXT DEFAULT '',
      language_preference TEXT DEFAULT 'English',
      timezone TEXT DEFAULT '',
      working_hours TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      model TEXT DEFAULT 'core',
      is_enabled INTEGER DEFAULT 1,
      task_type TEXT DEFAULT 'recurring',
      run_at TEXT,
      repeat_days TEXT DEFAULT '[]',
      repeat_time TEXT DEFAULT '09:00',
      instructions TEXT DEFAULT '',
      icon TEXT DEFAULT 'clock',
      color TEXT DEFAULT '#8A8783',
      last_run_at TEXT,
      last_run_status TEXT,
      next_run_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scheduled_runs (
      id TEXT PRIMARY KEY,
      scheduled_task_id TEXT NOT NULL
        REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER DEFAULT 0,
      status TEXT DEFAULT 'completed',
      error_message TEXT DEFAULT '',
      tokens_used INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_runs_task
    ON scheduled_runs(scheduled_task_id)
  `);

  await db.execute(`INSERT OR IGNORE INTO settings (id) VALUES (1)`);
  await db.execute(`INSERT OR IGNORE INTO memory_profile (id) VALUES (1)`);
}

async function ensureColumn(db: Database, table: string, column: string, ddl: string): Promise<void> {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch (err) {
    const message = String(err).toLowerCase();
    if (!message.includes('duplicate column name')) {
      throw err;
    }
  }
}

// ── SETTINGS ──────────────────────────────────────────────

export async function getSettings() {
  const db = await getDb();
  const rows = await db.select<any[]>('SELECT * FROM settings WHERE id = 1');
  return rows[0] || null;
}

export async function updateSettings(patch: Record<string, any>) {
  const db = await getDb();
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(patch), new Date().toISOString()];
  await db.execute(
    `UPDATE settings SET ${sets}, updated_at = ? WHERE id = 1`,
    vals
  );
}

// ── SESSIONS ──────────────────────────────────────────────

export async function getSessions() {
  const db = await getDb();
  return db.select<any[]>(
    'SELECT * FROM sessions WHERE is_archived = 0 ORDER BY updated_at DESC'
  );
}

export async function createSession(id: string, title: string) {
  const db = await getDb();
  await db.execute(
    'INSERT INTO sessions (id, title) VALUES (?, ?)',
    [id, title]
  );
}

export async function updateSessionTitle(id: string, title: string) {
  const db = await getDb();
  await db.execute(
    'UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?',
    [title, new Date().toISOString(), id]
  );
}

export async function touchSession(id: string) {
  const db = await getDb();
  await db.execute(
    'UPDATE sessions SET updated_at = ? WHERE id = ?',
    [new Date().toISOString(), id]
  );
}

export async function deleteSession(id: string) {
  const db = await getDb();
  await db.execute('DELETE FROM sessions WHERE id = ?', [id]);
}

export async function archiveSession(id: string) {
  const db = await getDb();
  await db.execute(
    'UPDATE sessions SET is_archived = 1 WHERE id = ?', [id]
  );
}

// ── MESSAGES ──────────────────────────────────────────────

export async function getMessages(sessionId: string) {
  const db = await getDb();
  return db.select<any[]>(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId]
  );
}

export async function addMessage(
  id: string,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  extra?: Record<string, any>
) {
  const db = await getDb();
  const columns = ['id', 'session_id', 'role', 'content'];
  const values: any[] = [id, sessionId, role, content];

  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined) continue;
    columns.push(key);
    values.push(value);
  }

  const placeholders = columns.map(() => '?').join(', ');
  await db.execute(
    `INSERT INTO messages (${columns.join(', ')}) VALUES (${placeholders})`,
    values
  );
  await touchSession(sessionId);
}

export async function updateMessage(id: string, patch: Record<string, any>) {
  const db = await getDb();
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  values.push(id);
  await db.execute(
    `UPDATE messages SET ${sets} WHERE id = ?`,
    values
  );
}

export async function deleteMessage(id: string) {
  const db = await getDb();
  await db.execute('DELETE FROM messages WHERE id = ?', [id]);
}

// ── MY APPS ───────────────────────────────────────────────

export async function getApps() {
  const db = await getDb();
  return db.select<any[]>('SELECT * FROM my_apps ORDER BY name ASC');
}

export async function saveApp(app: {
  id: string; name: string; app_type: string;
  url: string; description: string; usage_notes: string;
  credential_email: string; credential_password: string;
}) {
  const db = await getDb();
  await db.execute(`
    INSERT INTO my_apps
      (id, name, app_type, url, description, usage_notes,
       credential_email, credential_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      app_type = excluded.app_type,
      url = excluded.url,
      description = excluded.description,
      usage_notes = excluded.usage_notes,
      credential_email = excluded.credential_email,
      credential_password = excluded.credential_password,
      updated_at = datetime('now')
  `, [
    app.id, app.name, app.app_type, app.url,
    app.description, app.usage_notes,
    app.credential_email, app.credential_password
  ]);
}

export async function deleteApp(id: string) {
  const db = await getDb();
  await db.execute('DELETE FROM my_apps WHERE id = ?', [id]);
}

// ── MEMORY PROFILE ────────────────────────────────────────

export async function getMemoryProfile() {
  const db = await getDb();
  const rows = await db.select<any[]>(
    'SELECT * FROM memory_profile WHERE id = 1'
  );
  return rows[0] || null;
}

export async function updateMemoryProfile(patch: Record<string, any>) {
  const db = await getDb();
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(patch), new Date().toISOString()];
  await db.execute(
    `UPDATE memory_profile SET ${sets}, updated_at = ? WHERE id = 1`,
    vals
  );
}

// ── MEMORY ENTRIES ────────────────────────────────────────

export async function getMemoryEntries() {
  const db = await getDb();
  return db.select<any[]>(
    'SELECT * FROM memory_entries ORDER BY created_at DESC'
  );
}

export async function addMemoryEntry(id: string, content: string, source = 'manual') {
  const db = await getDb();
  await db.execute(
    'INSERT INTO memory_entries (id, content, source) VALUES (?, ?, ?)',
    [id, content, source]
  );
}

export async function updateMemoryEntry(id: string, content: string) {
  const db = await getDb();
  await db.execute(
    'UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ?',
    [content, new Date().toISOString(), id]
  );
}

export async function deleteMemoryEntry(id: string) {
  const db = await getDb();
  await db.execute('DELETE FROM memory_entries WHERE id = ?', [id]);
}

// ── SCHEDULED TASKS ───────────────────────────────────────

export async function getScheduledTasks() {
  const db = await getDb();
  return db.select<any[]>(
    'SELECT * FROM scheduled_tasks ORDER BY created_at DESC'
  );
}

export async function saveScheduledTask(task: Record<string, any>) {
  const db = await getDb();
  await db.execute(`
    INSERT INTO scheduled_tasks
      (id, title, description, model, is_enabled, task_type,
       run_at, repeat_days, repeat_time, instructions, icon, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      model = excluded.model,
      is_enabled = excluded.is_enabled,
      task_type = excluded.task_type,
      run_at = excluded.run_at,
      repeat_days = excluded.repeat_days,
      repeat_time = excluded.repeat_time,
      instructions = excluded.instructions,
      icon = excluded.icon,
      color = excluded.color,
      updated_at = datetime('now')
  `, [
    task.id, task.title, task.description, task.model,
    task.is_enabled ? 1 : 0, task.task_type,
    task.run_at || null,
    JSON.stringify(task.repeat_days || []),
    task.repeat_time, task.instructions,
    task.icon, task.color
  ]);
}

export async function deleteScheduledTask(id: string) {
  const db = await getDb();
  await db.execute('DELETE FROM scheduled_tasks WHERE id = ?', [id]);
}

export async function getScheduledRuns(taskId: string) {
  const db = await getDb();
  return db.select<any[]>(
    `SELECT * FROM scheduled_runs
     WHERE scheduled_task_id = ?
     ORDER BY started_at DESC LIMIT 10`,
    [taskId]
  );
}

export async function addScheduledRun(run: Record<string, any>) {
  const db = await getDb();
  await db.execute(`
    INSERT INTO scheduled_runs
      (id, scheduled_task_id, started_at, completed_at,
       duration_ms, status, error_message, tokens_used, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    run.id, run.scheduled_task_id, run.started_at,
    run.completed_at, run.duration_ms, run.status,
    run.error_message || '', run.tokens_used || 0, run.cost_usd || 0
  ]);
}
