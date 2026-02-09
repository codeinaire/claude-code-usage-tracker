import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb } from '../test/setup.js';
import { getDb } from './schema.js';
import {
  upsertSession,
  insertMessages,
  upsertSubagent,
  getSessionStats,
  getDailyStats,
  getSummary,
  getProjects,
  getCustomTitles,
  getSubagentsBySessionId,
  cleanupOrphanedSubagentSessions,
} from './queries.js';

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

describe('upsertSession', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('inserts a new session and returns its id', () => {
    const id = upsertSession({
      externalId: 'test-001',
      project: '/Users/test/project',
      startTime: '2026-01-15T10:00:00Z',
      endTime: '2026-01-15T10:30:00Z',
      model: 'claude-sonnet-4-20250514',
      version: '1.2.3',
      customTitle: null,
    });
    expect(id).toBeGreaterThan(0);

    const db = getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE external_id = 'test-001'").get() as Record<string, unknown>;
    expect(session).toBeDefined();
    expect(session.project).toBe('/Users/test/project');
    expect(session.model).toBe('claude-sonnet-4-20250514');
  });

  test('upsert updates existing session, keeping earliest start and latest end', () => {
    upsertSession({
      externalId: 'test-001',
      project: null,
      startTime: '2026-01-15T10:00:00Z',
      endTime: '2026-01-15T10:30:00Z',
      model: null,
      version: null,
      customTitle: null,
    });
    upsertSession({
      externalId: 'test-001',
      project: '/project',
      startTime: '2026-01-15T09:00:00Z',
      endTime: '2026-01-15T11:00:00Z',
      model: 'claude-sonnet-4',
      version: '1.0',
      customTitle: 'My Title',
    });

    const db = getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE external_id = 'test-001'").get() as Record<string, unknown>;
    expect(session.start_time).toBe('2026-01-15T09:00:00Z');
    expect(session.end_time).toBe('2026-01-15T11:00:00Z');
    expect(session.project).toBe('/project');
    expect(session.custom_title).toBe('My Title');
  });

  test('does not create duplicate sessions on re-upsert', () => {
    upsertSession({ externalId: 'dup-001', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });
    upsertSession({ externalId: 'dup-001', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM sessions WHERE external_id = 'dup-001'").get() as { c: number };
    expect(count.c).toBe(1);
  });
});

describe('insertMessages', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('inserts multiple messages in a transaction', () => {
    const sessionId = upsertSession({ externalId: 'sess-1', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });
    const count = insertMessages([
      { externalId: 'msg-1', sessionId, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { externalId: 'msg-2', sessionId, subagentId: null, timestamp: '2026-01-15T10:01:00Z', model: 'claude-sonnet-4', inputTokens: 2000, outputTokens: 800, cacheCreationInputTokens: 100, cacheReadInputTokens: 200 },
    ]);
    expect(count).toBe(2);

    const db = getDb();
    const msgs = db.prepare('SELECT * FROM messages WHERE session_id = ?').all(sessionId);
    expect(msgs).toHaveLength(2);
  });

  test('upserts messages on conflict (updates token counts)', () => {
    const sessionId = upsertSession({ externalId: 'sess-1', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });
    insertMessages([
      { externalId: 'msg-1', sessionId, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);
    insertMessages([
      { externalId: 'msg-1', sessionId, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);

    const db = getDb();
    const msg = db.prepare("SELECT * FROM messages WHERE external_id = 'msg-1'").get() as Record<string, unknown>;
    expect(msg.input_tokens).toBe(1000);
    expect(msg.output_tokens).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Cost Calculations
// ---------------------------------------------------------------------------

describe('cost calculations', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  function insertTestSession(externalId: string, model: string, tokens: { input: number; output: number; cacheWrite: number; cacheRead: number }) {
    const sessionId = upsertSession({
      externalId,
      project: null,
      startTime: '2026-01-15T10:00:00Z',
      endTime: '2026-01-15T10:30:00Z',
      model,
      version: null,
      customTitle: null,
    });
    insertMessages([{
      externalId: `msg-${externalId}`,
      sessionId,
      subagentId: null,
      timestamp: '2026-01-15T10:00:00Z',
      model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheCreationInputTokens: tokens.cacheWrite,
      cacheReadInputTokens: tokens.cacheRead,
    }]);
    return sessionId;
  }

  test('Sonnet 4 pricing: input=$3, cache_write=$3.75, cache_read=$0.30, output=$15 per 1M tokens', () => {
    insertTestSession('sonnet4-test', 'claude-sonnet-4-20250514', {
      input: 1000000, output: 1000000, cacheWrite: 1000000, cacheRead: 1000000,
    });

    const sessions = getSessionStats();
    expect(sessions).toHaveLength(1);
    // Expected: (1M * 3 + 1M * 3.75 + 1M * 0.3 + 1M * 15) / 1M = 22.05
    expect(sessions[0].estimatedCostUsd).toBeCloseTo(22.05, 2);
  });

  test('Sonnet 4.5 pricing under 200K context', () => {
    // Total context = 10K + 2K + 3K = 15K (under 200K threshold)
    insertTestSession('s45-low', 'claude-sonnet-4-5-20250514', {
      input: 10000, output: 5000, cacheWrite: 2000, cacheRead: 3000,
    });

    const sessions = getSessionStats();
    // Rates: input=$3, cache_write=$3.75, cache_read=$0.3, output=$15
    // Cost = (10000*3 + 2000*3.75 + 3000*0.3 + 5000*15) / 1000000
    //      = (30000 + 7500 + 900 + 75000) / 1000000 = 0.1134
    expect(sessions[0].estimatedCostUsd).toBeCloseTo(0.1134, 4);
  });

  test('Sonnet 4.5 pricing over 200K context uses higher rates', () => {
    // Total context = 150K + 30K + 25K = 205K (over 200K)
    insertTestSession('s45-high', 'claude-sonnet-4-5-20250514', {
      input: 150000, output: 5000, cacheWrite: 30000, cacheRead: 25000,
    });

    const sessions = getSessionStats();
    // Rates: input=$6, cache_write=$7.5, cache_read=$0.6, output=$22.5
    // Cost = (150000*6 + 30000*7.5 + 25000*0.6 + 5000*22.5) / 1000000
    //      = (900000 + 225000 + 15000 + 112500) / 1000000 = 1.2525
    expect(sessions[0].estimatedCostUsd).toBeCloseTo(1.2525, 4);
  });

  test('Opus 4.5 pricing: input=$5, cache_write=$6.25, cache_read=$0.5, output=$25', () => {
    insertTestSession('opus45-test', 'claude-opus-4-5-20250514', {
      input: 10000, output: 5000, cacheWrite: 2000, cacheRead: 3000,
    });

    const sessions = getSessionStats();
    // Cost = (10000*5 + 2000*6.25 + 3000*0.5 + 5000*25) / 1000000
    //      = (50000 + 12500 + 1500 + 125000) / 1000000 = 0.189
    expect(sessions[0].estimatedCostUsd).toBeCloseTo(0.189, 4);
  });

  test('Haiku 4.5 pricing: input=$1, cache_write=$1.25, cache_read=$0.1, output=$5', () => {
    insertTestSession('haiku45-test', 'claude-haiku-4-5-20250514', {
      input: 10000, output: 5000, cacheWrite: 2000, cacheRead: 3000,
    });

    const sessions = getSessionStats();
    // Cost = (10000*1 + 2000*1.25 + 3000*0.1 + 5000*5) / 1000000
    //      = (10000 + 2500 + 300 + 25000) / 1000000 = 0.0378
    expect(sessions[0].estimatedCostUsd).toBeCloseTo(0.0378, 4);
  });

  test('unknown model falls through to default (Sonnet 4) pricing', () => {
    insertTestSession('unknown-test', 'claude-unknown-model-v99', {
      input: 1000000, output: 1000000, cacheWrite: 1000000, cacheRead: 1000000,
    });

    const sessions = getSessionStats();
    // Same as Sonnet 4: 22.05
    expect(sessions[0].estimatedCostUsd).toBeCloseTo(22.05, 2);
  });
});

// ---------------------------------------------------------------------------
// Aggregation Queries
// ---------------------------------------------------------------------------

describe('getSessionStats', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('aggregates tokens across messages in a session', () => {
    const sessionId = upsertSession({
      externalId: 'agg-001',
      project: '/test',
      startTime: '2026-01-15T10:00:00Z',
      endTime: '2026-01-15T10:30:00Z',
      model: 'claude-sonnet-4',
      version: null,
      customTitle: null,
    });
    insertMessages([
      { externalId: 'msg-1', sessionId, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 100, cacheReadInputTokens: 200 },
      { externalId: 'msg-2', sessionId, subagentId: null, timestamp: '2026-01-15T10:01:00Z', model: 'claude-sonnet-4', inputTokens: 2000, outputTokens: 800, cacheCreationInputTokens: 300, cacheReadInputTokens: 400 },
    ]);

    const stats = getSessionStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].inputTokens).toBe(3000);
    expect(stats[0].outputTokens).toBe(1300);
    expect(stats[0].cacheCreationTokens).toBe(400);
    expect(stats[0].cacheReadTokens).toBe(600);
    expect(stats[0].messageCount).toBe(2);
  });

  test('filters sessions by date range', () => {
    upsertSession({ externalId: 'early', project: null, startTime: '2026-01-10T10:00:00Z', endTime: '2026-01-10T11:00:00Z', model: null, version: null, customTitle: null });
    upsertSession({ externalId: 'late', project: null, startTime: '2026-01-20T10:00:00Z', endTime: '2026-01-20T11:00:00Z', model: null, version: null, customTitle: null });

    const filtered = getSessionStats('2026-01-15', '2026-01-25');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].externalId).toBe('late');
  });

  test('filters sessions by project', () => {
    upsertSession({ externalId: 'proj-a', project: '/project-a', startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });
    upsertSession({ externalId: 'proj-b', project: '/project-b', startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });

    const filtered = getSessionStats(undefined, undefined, '/project-a');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].externalId).toBe('proj-a');
  });

  test('filters sessions by customTitle', () => {
    upsertSession({ externalId: 'titled', project: null, startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: 'Bug Fix' });
    upsertSession({ externalId: 'untitled', project: null, startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });

    const filtered = getSessionStats(undefined, undefined, undefined, 'Bug Fix');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].externalId).toBe('titled');
  });

  test('excludes agent-* sessions (subagent external IDs)', () => {
    upsertSession({ externalId: 'real-session', project: null, startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });
    upsertSession({ externalId: 'agent-sub-001', project: null, startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });

    const stats = getSessionStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].externalId).toBe('real-session');
  });

  test('includes subagentCount for sessions with subagents', () => {
    const sessionId = upsertSession({ externalId: 'parent', project: null, startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });
    upsertSubagent('agent-001', sessionId, null, null, null);
    upsertSubagent('agent-002', sessionId, null, null, null);

    const stats = getSessionStats();
    expect(stats[0].subagentCount).toBe(2);
  });
});

describe('getDailyStats', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('groups messages by date', () => {
    const sessionId = upsertSession({ externalId: 'daily-test', project: null, startTime: '2026-01-15T10:00:00Z', endTime: '2026-01-16T10:00:00Z', model: null, version: null, customTitle: null });
    insertMessages([
      { externalId: 'msg-d1', sessionId, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { externalId: 'msg-d2', sessionId, subagentId: null, timestamp: '2026-01-16T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 2000, outputTokens: 800, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);

    const daily = getDailyStats();
    expect(daily).toHaveLength(2);
    // Ordered DESC, so first entry is the later date
    expect(daily[0].date).toBe('2026-01-16');
    expect(daily[0].inputTokens).toBe(2000);
    expect(daily[1].date).toBe('2026-01-15');
    expect(daily[1].inputTokens).toBe(1000);
  });

  test('filters by date range', () => {
    const sessionId = upsertSession({ externalId: 'daily-filter', project: null, startTime: '2026-01-10T10:00:00Z', endTime: '2026-01-20T10:00:00Z', model: null, version: null, customTitle: null });
    insertMessages([
      { externalId: 'msg-df1', sessionId, subagentId: null, timestamp: '2026-01-10T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { externalId: 'msg-df2', sessionId, subagentId: null, timestamp: '2026-01-20T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 2000, outputTokens: 800, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);

    const daily = getDailyStats('2026-01-15', '2026-01-25');
    expect(daily).toHaveLength(1);
    expect(daily[0].date).toBe('2026-01-20');
  });
});

describe('getSummary', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('returns aggregate totals across all sessions', () => {
    const s1 = upsertSession({ externalId: 'sum-1', project: null, startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });
    const s2 = upsertSession({ externalId: 'sum-2', project: null, startTime: '2026-01-16T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });

    insertMessages([
      { externalId: 'msg-s1', sessionId: s1, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 100, cacheReadInputTokens: 200 },
      { externalId: 'msg-s2', sessionId: s2, subagentId: null, timestamp: '2026-01-16T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 2000, outputTokens: 800, cacheCreationInputTokens: 300, cacheReadInputTokens: 400 },
    ]);

    const summary = getSummary();
    expect(summary.inputTokens).toBe(3000);
    expect(summary.outputTokens).toBe(1300);
    expect(summary.cacheCreationTokens).toBe(400);
    expect(summary.cacheReadTokens).toBe(600);
    expect(summary.sessionCount).toBe(2);
    expect(summary.firstSession).toBe('2026-01-15');
    expect(summary.lastSession).toBe('2026-01-16');
  });

  test('computes cache savings (costWithoutCache > totalCost when cache_read is used)', () => {
    const sid = upsertSession({ externalId: 'cache-test', project: null, startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });
    insertMessages([{
      externalId: 'msg-cache', sessionId: sid, subagentId: null,
      timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4',
      inputTokens: 0, outputTokens: 0,
      cacheCreationInputTokens: 0, cacheReadInputTokens: 1000000,
    }]);

    const summary = getSummary();
    // With cache: 1M * 0.3 / 1M = 0.3
    // Without cache: 1M * 3.0 / 1M = 3.0
    expect(summary.totalCostUsd).toBeCloseTo(0.3, 2);
    expect(summary.costWithoutCacheUsd).toBeCloseTo(3.0, 2);
  });

  test('returns zeros for empty database', () => {
    const summary = getSummary();
    expect(summary.inputTokens).toBe(0);
    expect(summary.outputTokens).toBe(0);
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.sessionCount).toBe(0);
    expect(summary.firstSession).toBeNull();
    expect(summary.lastSession).toBeNull();
  });

  test('filters by project', () => {
    const s1 = upsertSession({ externalId: 'sp-1', project: '/proj-a', startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });
    const s2 = upsertSession({ externalId: 'sp-2', project: '/proj-b', startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });

    insertMessages([
      { externalId: 'msg-sp1', sessionId: s1, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { externalId: 'msg-sp2', sessionId: s2, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 2000, outputTokens: 800, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);

    const summary = getSummary('/proj-a');
    expect(summary.inputTokens).toBe(1000);
    expect(summary.sessionCount).toBe(1);
  });
});

describe('getProjects', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('returns distinct non-null projects, excluding agent-* sessions', () => {
    upsertSession({ externalId: 'p1', project: '/project-a', startTime: null, endTime: null, model: null, version: null, customTitle: null });
    upsertSession({ externalId: 'p2', project: '/project-b', startTime: null, endTime: null, model: null, version: null, customTitle: null });
    upsertSession({ externalId: 'p3', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });
    upsertSession({ externalId: 'agent-x', project: '/project-a', startTime: null, endTime: null, model: null, version: null, customTitle: null });

    const projects = getProjects();
    expect(projects).toEqual(['/project-a', '/project-b']);
  });
});

describe('getCustomTitles', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('returns distinct non-null custom titles, excluding agent-* sessions', () => {
    upsertSession({ externalId: 't1', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: 'Alpha' });
    upsertSession({ externalId: 't2', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: 'Beta' });
    upsertSession({ externalId: 't3', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });
    upsertSession({ externalId: 'agent-t', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: 'Agent Title' });

    const titles = getCustomTitles();
    expect(titles).toEqual(['Alpha', 'Beta']);
  });
});

describe('getSubagentsBySessionId', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('returns subagents with aggregated message stats', () => {
    const sessionId = upsertSession({ externalId: 'parent-sa', project: null, startTime: '2026-01-15T10:00:00Z', endTime: null, model: null, version: null, customTitle: null });
    const subId = upsertSubagent('agent-001', sessionId, 'claude-sonnet-4', '2026-01-15T10:01:00Z', '2026-01-15T10:05:00Z');

    insertMessages([
      { externalId: 'msg-sa1', sessionId, subagentId: subId, timestamp: '2026-01-15T10:01:00Z', model: 'claude-sonnet-4', inputTokens: 500, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { externalId: 'msg-sa2', sessionId, subagentId: subId, timestamp: '2026-01-15T10:02:00Z', model: 'claude-sonnet-4', inputTokens: 600, outputTokens: 300, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);

    const subagents = getSubagentsBySessionId(sessionId);
    expect(subagents).toHaveLength(1);
    expect(subagents[0].externalId).toBe('agent-001');
    expect(subagents[0].inputTokens).toBe(1100);
    expect(subagents[0].outputTokens).toBe(500);
    expect(subagents[0].messageCount).toBe(2);
    expect(subagents[0].estimatedCostUsd).toBeGreaterThan(0);
  });

  test('returns empty array for session with no subagents', () => {
    const sessionId = upsertSession({ externalId: 'no-sub', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });
    const subagents = getSubagentsBySessionId(sessionId);
    expect(subagents).toEqual([]);
  });
});

describe('cleanupOrphanedSubagentSessions', () => {
  beforeEach(() => setupTestDb());
  afterEach(() => teardownTestDb());

  test('removes sessions and messages with agent-* external IDs', () => {
    const orphanId = upsertSession({ externalId: 'agent-orphan', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });
    const realId = upsertSession({ externalId: 'real-session', project: null, startTime: null, endTime: null, model: null, version: null, customTitle: null });

    insertMessages([
      { externalId: 'msg-orphan', sessionId: orphanId, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { externalId: 'msg-real', sessionId: realId, subagentId: null, timestamp: '2026-01-15T10:00:00Z', model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);

    cleanupOrphanedSubagentSessions();

    const db = getDb();
    const sessions = db.prepare('SELECT * FROM sessions').all();
    expect(sessions).toHaveLength(1);
    expect((sessions[0] as Record<string, unknown>).external_id).toBe('real-session');

    const messages = db.prepare('SELECT * FROM messages').all();
    expect(messages).toHaveLength(1);
  });
});
