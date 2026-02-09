import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { setupTestDb, teardownTestDb } from '../test/setup.js';
import { getDb } from '../db/schema.js';
import { getSyncState } from '../db/queries.js';
import {
  isSubagentFile,
  extractProjectFromPath,
  extractSessionExternalIdFromPath,
  extractParentSessionExternalId,
  parseSessionFile,
} from './jsonl.js';
import {
  BASIC_SESSION_JSONL,
  STREAMING_DEDUP_JSONL,
  SESSION_WITH_TITLE_JSONL,
  SESSION_WITH_SKIPPABLE_JSONL,
  SESSION_WITH_INVALID_LINES_JSONL,
  SUBAGENT_JSONL,
} from '../test/fixtures.js';

// ---------------------------------------------------------------------------
// Pure Function Unit Tests (no DB needed)
// ---------------------------------------------------------------------------

describe('isSubagentFile', () => {
  test('returns true for path containing /subagents/', () => {
    expect(isSubagentFile('/home/user/.claude/projects/foo/abc-123/subagents/agent-001.jsonl')).toBe(true);
  });

  test('returns false for regular session file', () => {
    expect(isSubagentFile('/home/user/.claude/projects/foo/abc-123.jsonl')).toBe(false);
  });

  test('returns false when "subagents" is part of a filename not a directory', () => {
    expect(isSubagentFile('/home/user/.claude/projects/foo/subagents.jsonl')).toBe(false);
  });
});

describe('extractSessionExternalIdFromPath', () => {
  test('extracts UUID basename without .jsonl extension', () => {
    expect(extractSessionExternalIdFromPath('/some/path/abc-def-123.jsonl')).toBe('abc-def-123');
  });

  test('extracts agent filename for subagent files', () => {
    expect(extractSessionExternalIdFromPath('/path/to/subagents/agent-001.jsonl')).toBe('agent-001');
  });
});

describe('extractProjectFromPath', () => {
  test('extracts and decodes project path from ~/.claude/projects/', () => {
    const homedir = os.homedir();
    const filePath = path.join(homedir, '.claude', 'projects', '-Users-nousunio-my-project', 'session-123.jsonl');
    expect(extractProjectFromPath(filePath)).toBe('/Users/nousunio/my/project');
  });

  test('returns null for paths not under ~/.claude/projects/', () => {
    expect(extractProjectFromPath('/tmp/some/other/path/session.jsonl')).toBeNull();
  });
});

describe('extractParentSessionExternalId', () => {
  test('extracts parent session UUID from subagent path', () => {
    const filePath = '/home/user/.claude/projects/foo/parent-uuid-123/subagents/agent-001.jsonl';
    expect(extractParentSessionExternalId(filePath)).toBe('parent-uuid-123');
  });

  test('returns null when no subagents directory found', () => {
    expect(extractParentSessionExternalId('/home/user/session.jsonl')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseSessionFile Integration Tests (requires DB + temp file)
// ---------------------------------------------------------------------------

describe('parseSessionFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    setupTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctracker-test-'));
  });

  afterEach(() => {
    teardownTestDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('parses basic session and inserts into database', () => {
    const filePath = path.join(tmpDir, 'abc-123.jsonl');
    fs.writeFileSync(filePath, BASIC_SESSION_JSONL);

    const result = parseSessionFile(filePath, false);

    expect(result.sessionExternalId).toBe('abc-123');
    expect(result.messagesImported).toBe(2);
    expect(result.project).toBeNull(); // Not under ~/.claude/projects/

    // Verify DB state
    const db = getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE external_id = 'abc-123'").get() as Record<string, unknown>;
    expect(session).toBeDefined();
    expect(session.model).toBe('claude-sonnet-4-20250514');
    expect(session.version).toBe('1.2.3');
    expect(session.start_time).toBe('2026-01-15T10:00:00.000Z');
    expect(session.end_time).toBe('2026-01-15T10:00:12.000Z');

    const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all(session.id as number);
    expect(messages).toHaveLength(2);
  });

  test('correctly sums token counts from parsed messages', () => {
    const filePath = path.join(tmpDir, 'abc-123.jsonl');
    fs.writeFileSync(filePath, BASIC_SESSION_JSONL);

    parseSessionFile(filePath, false);

    const db = getDb();
    const totals = db.prepare(`
      SELECT
        SUM(input_tokens) as totalInput,
        SUM(output_tokens) as totalOutput,
        SUM(cache_creation_input_tokens) as totalCacheWrite,
        SUM(cache_read_input_tokens) as totalCacheRead
      FROM messages
    `).get() as Record<string, number>;

    // msg-a1: input=1000, output=500, cache_write=200, cache_read=100
    // msg-a2: input=2000, output=800, cache_write=300, cache_read=500
    expect(totals.totalInput).toBe(3000);
    expect(totals.totalOutput).toBe(1300);
    expect(totals.totalCacheWrite).toBe(500);
    expect(totals.totalCacheRead).toBe(600);
  });

  test('deduplicates streaming messages by keeping last occurrence', () => {
    const filePath = path.join(tmpDir, 'stream-001.jsonl');
    fs.writeFileSync(filePath, STREAMING_DEDUP_JSONL);

    const result = parseSessionFile(filePath, false);

    expect(result.messagesImported).toBe(1); // 3 lines with same ID -> 1 message

    const db = getDb();
    const msg = db.prepare("SELECT * FROM messages WHERE external_id = 'msg-stream'").get() as Record<string, unknown>;
    expect(msg.output_tokens).toBe(200); // Last occurrence wins
    expect(msg.input_tokens).toBe(100);
  });

  test('skips file-history-snapshot lines', () => {
    const filePath = path.join(tmpDir, 'skip-001.jsonl');
    fs.writeFileSync(filePath, SESSION_WITH_SKIPPABLE_JSONL);

    const result = parseSessionFile(filePath, false);
    expect(result.messagesImported).toBe(1);
  });

  test('handles invalid JSON lines gracefully', () => {
    const filePath = path.join(tmpDir, 'bad-001.jsonl');
    fs.writeFileSync(filePath, SESSION_WITH_INVALID_LINES_JSONL);

    const result = parseSessionFile(filePath, false);
    expect(result.messagesImported).toBe(1); // Only the valid assistant message
  });

  test('extracts custom title from JSONL', () => {
    const filePath = path.join(tmpDir, 'titled-001.jsonl');
    fs.writeFileSync(filePath, SESSION_WITH_TITLE_JSONL);

    parseSessionFile(filePath, false);

    const db = getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE external_id = 'titled-001'").get() as Record<string, unknown>;
    expect(session.custom_title).toBe('Fix login bug');
    expect(session.version).toBe('1.3.0');
  });

  test('throws error for non-existent file', () => {
    expect(() => parseSessionFile('/nonexistent/path.jsonl', false)).toThrow('File not found');
  });

  test('records sync state after parsing', () => {
    const filePath = path.join(tmpDir, 'abc-123.jsonl');
    fs.writeFileSync(filePath, BASIC_SESSION_JSONL);

    parseSessionFile(filePath, false);

    const syncState = getSyncState(filePath);
    expect(syncState).not.toBeNull();
    expect(syncState!.lastOffset).toBeGreaterThan(0);
  });

  test('incremental sync skips already-synced data', () => {
    const filePath = path.join(tmpDir, 'abc-123.jsonl');
    fs.writeFileSync(filePath, BASIC_SESSION_JSONL);

    // First parse
    parseSessionFile(filePath, true);

    // Second parse with no new data
    const result = parseSessionFile(filePath, true);
    expect(result.messagesImported).toBe(0);
  });

  test('upserts session on re-parse (does not duplicate)', () => {
    const filePath = path.join(tmpDir, 'abc-123.jsonl');
    fs.writeFileSync(filePath, BASIC_SESSION_JSONL);

    parseSessionFile(filePath, false);
    parseSessionFile(filePath, false);

    const db = getDb();
    const sessions = db.prepare("SELECT * FROM sessions WHERE external_id = 'abc-123'").all();
    expect(sessions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Subagent Parsing Tests
// ---------------------------------------------------------------------------

describe('parseSessionFile - subagents', () => {
  let tmpDir: string;

  beforeEach(() => {
    setupTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctracker-test-'));
  });

  afterEach(() => {
    teardownTestDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('parses subagent file and links to parent session', () => {
    // Create parent session first
    const parentFile = path.join(tmpDir, 'parent-uuid-123.jsonl');
    fs.writeFileSync(parentFile, BASIC_SESSION_JSONL.replace(/abc-123/g, 'parent-uuid-123'));
    parseSessionFile(parentFile, false);

    // Create subagent directory structure
    const subDir = path.join(tmpDir, 'parent-uuid-123', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    const subFile = path.join(subDir, 'agent-sub-001.jsonl');
    fs.writeFileSync(subFile, SUBAGENT_JSONL);

    const result = parseSessionFile(subFile, false);
    expect(result.messagesImported).toBe(1);

    const db = getDb();
    const subagents = db.prepare('SELECT * FROM subagents').all();
    expect(subagents).toHaveLength(1);
    expect((subagents[0] as Record<string, unknown>).external_id).toBe('agent-sub-001');

    // Subagent messages are linked to parent session
    const parentSession = db.prepare("SELECT id FROM sessions WHERE external_id = 'parent-uuid-123'").get() as { id: number };
    const messages = db.prepare('SELECT * FROM messages WHERE subagent_id IS NOT NULL').all() as Record<string, unknown>[];
    expect(messages).toHaveLength(1);
    expect(messages[0].session_id).toBe(parentSession.id);
  });

  test('auto-creates parent session if it does not exist', () => {
    // Create subagent without parsing parent first
    const subDir = path.join(tmpDir, 'new-parent-uuid', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    const subFile = path.join(subDir, 'agent-sub-001.jsonl');
    fs.writeFileSync(subFile, SUBAGENT_JSONL);

    parseSessionFile(subFile, false);

    const db = getDb();
    const parent = db.prepare("SELECT * FROM sessions WHERE external_id = 'new-parent-uuid'").get() as Record<string, unknown>;
    expect(parent).toBeDefined();
    expect(parent.model).toBeNull(); // Auto-created with minimal data
  });

  test('main session file auto-parses subagent files in subdirectory', () => {
    // Create subagent directory with a file
    const subDir = path.join(tmpDir, 'abc-123', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    const subFile = path.join(subDir, 'agent-sub-001.jsonl');
    fs.writeFileSync(subFile, SUBAGENT_JSONL);

    // Create and parse main session file - it should auto-discover subagent
    const mainFile = path.join(tmpDir, 'abc-123.jsonl');
    fs.writeFileSync(mainFile, BASIC_SESSION_JSONL);

    const result = parseSessionFile(mainFile, false);
    // Main session has 2 messages + subagent has 1 message
    expect(result.messagesImported).toBe(3);

    const db = getDb();
    const subagents = db.prepare('SELECT * FROM subagents').all();
    expect(subagents).toHaveLength(1);
  });
});
