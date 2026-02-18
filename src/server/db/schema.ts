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

    -- usage_records table: individual API calls with token usage (previously named "messages")
    CREATE TABLE IF NOT EXISTS usage_records (
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

    -- exchanges table: one row per conversation turn (user message → Claude response)
    CREATE TABLE IF NOT EXISTS exchanges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_message_uuid TEXT,
      user_timestamp TEXT NOT NULL,
      assistant_message_id TEXT,
      assistant_last_timestamp TEXT,
      duration_seconds REAL,
      user_content TEXT,
      UNIQUE(session_id, user_timestamp)
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
    CREATE INDEX IF NOT EXISTS idx_usage_records_session ON usage_records(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_external_id ON sessions(external_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
    CREATE INDEX IF NOT EXISTS idx_subagents_session ON subagents(session_id);
    CREATE INDEX IF NOT EXISTS idx_subagents_external_id ON subagents(external_id);
    CREATE INDEX IF NOT EXISTS idx_usage_records_external_id ON usage_records(external_id);
    CREATE INDEX IF NOT EXISTS idx_exchanges_session ON exchanges(session_id);
    CREATE INDEX IF NOT EXISTS idx_exchanges_user_timestamp ON exchanges(user_timestamp);

    -- App settings (key/value store)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migration: add custom_title column for existing databases
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN custom_title TEXT`);
  } catch {
    // Column already exists
  }

  // Migration: drop old messages table (renamed to usage_records)
  try {
    db.exec(`DROP TABLE IF EXISTS messages`);
  } catch {
    // Already dropped or never existed
  }
}
