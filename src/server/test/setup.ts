import Database from 'better-sqlite3';
import { setDb, closeDb } from '../db/schema.js';

/**
 * Creates a fresh in-memory SQLite database and injects it into the schema singleton.
 * Call in beforeEach() for test isolation.
 */
export function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  setDb(db);
  return db;
}

/**
 * Tears down the test database. Call in afterEach().
 */
export function teardownTestDb(): void {
  closeDb();
}
