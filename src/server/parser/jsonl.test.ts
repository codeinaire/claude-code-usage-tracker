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
  MULTI_TURN_JSONL,
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
    expect(result.usageRecordsImported).toBe(2);
    expect(result.project).toBeNull(); // Not under ~/.claude/projects/

    // Verify DB state
    const db = getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE external_id = 'abc-123'").get() as Record<string, unknown>;
    expect(session).toBeDefined();
    expect(session.model).toBe('claude-sonnet-4-20250514');
    expect(session.version).toBe('1.2.3');
    expect(session.start_time).toBe('2026-01-15T10:00:00.000Z');
    expect(session.end_time).toBe('2026-01-15T10:00:12.000Z');

    const records = db.prepare('SELECT * FROM usage_records WHERE session_id = ?').all(session.id as number);
    expect(records).toHaveLength(2);
  });

  test('correctly sums token counts from parsed usage records', () => {
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
      FROM usage_records
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

    expect(result.usageRecordsImported).toBe(1); // 3 lines with same ID -> 1 record

    const db = getDb();
    const rec = db.prepare("SELECT * FROM usage_records WHERE external_id = 'msg-stream'").get() as Record<string, unknown>;
    expect(rec.output_tokens).toBe(200); // Last occurrence wins
    expect(rec.input_tokens).toBe(100);
  });

  test('skips file-history-snapshot lines', () => {
    const filePath = path.join(tmpDir, 'skip-001.jsonl');
    fs.writeFileSync(filePath, SESSION_WITH_SKIPPABLE_JSONL);

    const result = parseSessionFile(filePath, false);
    expect(result.usageRecordsImported).toBe(1);
  });

  test('handles invalid JSON lines gracefully', () => {
    const filePath = path.join(tmpDir, 'bad-001.jsonl');
    fs.writeFileSync(filePath, SESSION_WITH_INVALID_LINES_JSONL);

    const result = parseSessionFile(filePath, false);
    expect(result.usageRecordsImported).toBe(1); // Only the valid assistant message
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
    expect(result.usageRecordsImported).toBe(0);
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
// Exchange / Turn Tracking Tests (format regression tests)
// ---------------------------------------------------------------------------

describe('parseSessionFile - exchange tracking', () => {
  let tmpDir: string;

  beforeEach(() => {
    setupTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctracker-test-'));
  });

  afterEach(() => {
    teardownTestDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('MULTI_TURN_JSONL: creates correct number of exchanges', () => {
    const filePath = path.join(tmpDir, 'multi-001.jsonl');
    fs.writeFileSync(filePath, MULTI_TURN_JSONL);

    const result = parseSessionFile(filePath, false);

    // 3 user→assistant turns, 3 unique usage records (msg-m1 deduped to 1)
    expect(result.usageRecordsImported).toBe(3);
    expect(result.exchangesImported).toBe(3);

    const db = getDb();
    const exchanges = db.prepare('SELECT * FROM exchanges ORDER BY user_timestamp').all() as Record<string, unknown>[];
    expect(exchanges).toHaveLength(3);
  });

  test('MULTI_TURN_JSONL: turn 1 duration is 12 seconds (streaming dedup)', () => {
    const filePath = path.join(tmpDir, 'multi-001.jsonl');
    fs.writeFileSync(filePath, MULTI_TURN_JSONL);

    parseSessionFile(filePath, false);

    const db = getDb();
    const exchanges = db.prepare('SELECT * FROM exchanges ORDER BY user_timestamp').all() as Record<string, unknown>[];

    // Turn 1: user at T+0s, last assistant chunk at T+12s → 12 seconds
    expect(exchanges[0].duration_seconds).toBeCloseTo(12, 1);
    // Turn 2: user at T+30s, assistant at T+45s → 15 seconds
    expect(exchanges[1].duration_seconds).toBeCloseTo(15, 1);
    // Turn 3: user at T+60s, assistant at T+90s → 30 seconds
    expect(exchanges[2].duration_seconds).toBeCloseTo(30, 1);
  });

  test('MULTI_TURN_JSONL: user_content is captured', () => {
    const filePath = path.join(tmpDir, 'multi-001.jsonl');
    fs.writeFileSync(filePath, MULTI_TURN_JSONL);

    parseSessionFile(filePath, false);

    const db = getDb();
    const exchanges = db.prepare('SELECT user_content FROM exchanges ORDER BY user_timestamp').all() as Record<string, unknown>[];
    expect(exchanges[0].user_content).toBe('What is 2+2?');
    expect(exchanges[1].user_content).toBe('What is the capital of France?');
    expect(exchanges[2].user_content).toBe('Tell me a joke.');
  });

  test('MULTI_TURN_JSONL: streaming dedup - msg-m1 stored with final token counts', () => {
    const filePath = path.join(tmpDir, 'multi-001.jsonl');
    fs.writeFileSync(filePath, MULTI_TURN_JSONL);

    parseSessionFile(filePath, false);

    const db = getDb();
    // msg-m1 appears twice (streaming), last wins: output=50, cache_write=100, cache_read=200
    const rec = db.prepare("SELECT * FROM usage_records WHERE external_id = 'msg-m1'").get() as Record<string, unknown>;
    expect(rec.output_tokens).toBe(50);
    expect(rec.cache_creation_input_tokens).toBe(100);
    expect(rec.cache_read_input_tokens).toBe(200);
  });

  test('BASIC_SESSION_JSONL: creates 2 exchanges (2 user→assistant turns)', () => {
    const filePath = path.join(tmpDir, 'abc-123.jsonl');
    fs.writeFileSync(filePath, BASIC_SESSION_JSONL);

    const result = parseSessionFile(filePath, false);

    expect(result.exchangesImported).toBe(2);

    const db = getDb();
    const exchanges = db.prepare('SELECT * FROM exchanges ORDER BY user_timestamp').all() as Record<string, unknown>[];
    expect(exchanges).toHaveLength(2);
    // Turn 1: user at T+0s, assistant at T+2s → 2 seconds
    expect(exchanges[0].duration_seconds).toBeCloseTo(2, 1);
    // Turn 2: user at T+10s, assistant at T+12s → 2 seconds
    expect(exchanges[1].duration_seconds).toBeCloseTo(2, 1);
  });

  test('re-parse (full sync) clears and recreates exchanges without duplication', () => {
    const filePath = path.join(tmpDir, 'abc-123.jsonl');
    fs.writeFileSync(filePath, BASIC_SESSION_JSONL);

    parseSessionFile(filePath, false);
    parseSessionFile(filePath, false);

    const db = getDb();
    const exchanges = db.prepare('SELECT * FROM exchanges').all();
    expect(exchanges).toHaveLength(2); // No duplicates
  });

  test('isMeta user lines are not counted as turn starts', () => {
    const jsonl = [
      '{"type":"user","sessionId":"meta-001","timestamp":"2026-01-15T10:00:00.000Z","message":{"role":"user","content":"hello"}}',
      '{"type":"assistant","sessionId":"meta-001","timestamp":"2026-01-15T10:00:05.000Z","message":{"id":"msg-meta1","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
      '{"type":"user","sessionId":"meta-001","timestamp":"2026-01-15T10:05:00.000Z","isMeta":true,"message":{"role":"user","content":"/exit"}}',
    ].join('\n');

    const filePath = path.join(tmpDir, 'meta-001.jsonl');
    fs.writeFileSync(filePath, jsonl);

    const result = parseSessionFile(filePath, false);

    // Only 1 complete turn (the /exit meta line does not start a new turn)
    expect(result.exchangesImported).toBe(1);
    expect(result.usageRecordsImported).toBe(1);
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
    expect(result.usageRecordsImported).toBe(1);

    const db = getDb();
    const subagents = db.prepare('SELECT * FROM subagents').all();
    expect(subagents).toHaveLength(1);
    expect((subagents[0] as Record<string, unknown>).external_id).toBe('agent-sub-001');

    // Subagent usage records are linked to parent session
    const parentSession = db.prepare("SELECT id FROM sessions WHERE external_id = 'parent-uuid-123'").get() as { id: number };
    const records = db.prepare('SELECT * FROM usage_records WHERE subagent_id IS NOT NULL').all() as Record<string, unknown>[];
    expect(records).toHaveLength(1);
    expect(records[0].session_id).toBe(parentSession.id);
  });

  test('subagent file does not create exchanges', () => {
    const subDir = path.join(tmpDir, 'new-parent-uuid', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    const subFile = path.join(subDir, 'agent-sub-001.jsonl');
    fs.writeFileSync(subFile, SUBAGENT_JSONL);

    const result = parseSessionFile(subFile, false);
    expect(result.exchangesImported).toBe(0);

    const db = getDb();
    const exchanges = db.prepare('SELECT * FROM exchanges').all();
    expect(exchanges).toHaveLength(0);
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
    // Main session has 2 usage records + subagent has 1 usage record
    expect(result.usageRecordsImported).toBe(3);

    const db = getDb();
    const subagents = db.prepare('SELECT * FROM subagents').all();
    expect(subagents).toHaveLength(1);
  });
});
