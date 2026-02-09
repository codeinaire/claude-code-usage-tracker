import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../../data/usage.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function setDb(database: Database.Database): void {
  db = database;
  initializeSchema(db);
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- Sessions table: one row per Claude Code session
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT UNIQUE NOT NULL,
      project TEXT,
      start_time TEXT,
      end_time TEXT,
      model TEXT,
      version TEXT,
      custom_title TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Subagents table: tracks subagent sessions within a main session
    CREATE TABLE IF NOT EXISTS subagents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT UNIQUE NOT NULL,
      session_id INTEGER NOT NULL,
      type TEXT,
      start_time TEXT,
      end_time TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    -- Messages table: individual API calls with token usage
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT UNIQUE NOT NULL,
      session_id INTEGER NOT NULL,
      subagent_id INTEGER,
      timestamp TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_creation_input_tokens INTEGER DEFAULT 0,
      cache_read_input_tokens INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (subagent_id) REFERENCES subagents(id)
    );

    -- Daily stats table: pre-aggregated daily statistics
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_creation_tokens INTEGER DEFAULT 0,
      total_cache_read_tokens INTEGER DEFAULT 0,
      session_count INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0
    );

    -- Track sync state per session file
    CREATE TABLE IF NOT EXISTS sync_state (
      file_path TEXT PRIMARY KEY,
      last_offset INTEGER DEFAULT 0,
      last_synced TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_external_id ON sessions(external_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
    CREATE INDEX IF NOT EXISTS idx_subagents_session ON subagents(session_id);
    CREATE INDEX IF NOT EXISTS idx_subagents_external_id ON subagents(external_id);
    CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id);
  `);

  // Migration: add custom_title column for existing databases
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN custom_title TEXT`);
  } catch {
    // Column already exists
  }
}
