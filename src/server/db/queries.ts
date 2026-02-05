import { getDb } from './schema.js';

// Per-message cost calculation in SQL
// Pricing per 1M tokens (USD) - https://claude.com/pricing
// Cache write = 125% of base input, Cache read = 10% of base input
// Sonnet 4.5 has tiered pricing: >200K input context uses higher rates
// CASE order matters: more specific patterns (e.g. sonnet-4-5) must come before
// broader ones (e.g. sonnet-4) since both would match the broader pattern
const MESSAGE_COST_SQL = `
  CASE
    WHEN m.model LIKE 'claude-sonnet-4-5%' AND
         (m.input_tokens + m.cache_creation_input_tokens + m.cache_read_input_tokens) > 200000 THEN
      (m.input_tokens * 6.0 + m.cache_creation_input_tokens * 7.5 + m.cache_read_input_tokens * 0.6 + m.output_tokens * 22.5) / 1000000.0
    WHEN m.model LIKE 'claude-sonnet-4-5%' THEN
      (m.input_tokens * 3.0 + m.cache_creation_input_tokens * 3.75 + m.cache_read_input_tokens * 0.3 + m.output_tokens * 15.0) / 1000000.0
    WHEN m.model LIKE 'claude-opus-4-5%' THEN
      (m.input_tokens * 5.0 + m.cache_creation_input_tokens * 6.25 + m.cache_read_input_tokens * 0.5 + m.output_tokens * 25.0) / 1000000.0
    WHEN m.model LIKE 'claude-haiku-4-5%' THEN
      (m.input_tokens * 1.0 + m.cache_creation_input_tokens * 1.25 + m.cache_read_input_tokens * 0.1 + m.output_tokens * 5.0) / 1000000.0
    WHEN m.model LIKE 'claude-sonnet-4%' THEN
      (m.input_tokens * 3.0 + m.cache_creation_input_tokens * 3.75 + m.cache_read_input_tokens * 0.3 + m.output_tokens * 15.0) / 1000000.0
    ELSE
      (m.input_tokens * 3.0 + m.cache_creation_input_tokens * 3.75 + m.cache_read_input_tokens * 0.3 + m.output_tokens * 15.0) / 1000000.0
  END
`;

export interface Session {
  externalId: string;
  project: string | null;
  startTime: string | null;
  endTime: string | null;
  model: string | null;
  version: string | null;
}

export interface Message {
  externalId: string;
  sessionId: number;
  subagentId: number | null;
  timestamp: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function upsertSession(session: Session): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sessions (external_id, project, start_time, end_time, model, version)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET
      project = COALESCE(excluded.project, project),
      start_time = COALESCE(
        CASE WHEN excluded.start_time < start_time THEN excluded.start_time ELSE start_time END,
        excluded.start_time,
        start_time
      ),
      end_time = COALESCE(
        CASE WHEN excluded.end_time > end_time THEN excluded.end_time ELSE end_time END,
        excluded.end_time,
        end_time
      ),
      model = COALESCE(excluded.model, model),
      version = COALESCE(excluded.version, version)
    RETURNING id
  `);
  const result = stmt.get(
    session.externalId,
    session.project,
    session.startTime,
    session.endTime,
    session.model,
    session.version
  ) as { id: number };
  return result.id;
}

export function getSessionIdByExternalId(externalId: string): number | null {
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM sessions WHERE external_id = ?')
    .get(externalId) as { id: number } | undefined;
  return row ? row.id : null;
}

export function upsertSubagent(
  externalId: string,
  sessionId: number,
  type: string | null,
  startTime: string | null,
  endTime: string | null
): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO subagents (external_id, session_id, type, start_time, end_time)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET
      start_time = COALESCE(
        CASE WHEN excluded.start_time < start_time THEN excluded.start_time ELSE start_time END,
        excluded.start_time,
        start_time
      ),
      end_time = COALESCE(
        CASE WHEN excluded.end_time > end_time THEN excluded.end_time ELSE end_time END,
        excluded.end_time,
        end_time
      )
    RETURNING id
  `);
  const result = stmt.get(externalId, sessionId, type, startTime, endTime) as { id: number };
  return result.id;
}

export function getSubagentIdByExternalId(externalId: string): number | null {
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM subagents WHERE external_id = ?')
    .get(externalId) as { id: number } | undefined;
  return row ? row.id : null;
}

export function insertMessages(messages: Message[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO messages (
      external_id, session_id, subagent_id, timestamp, model,
      input_tokens, output_tokens,
      cache_creation_input_tokens, cache_read_input_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_creation_input_tokens = excluded.cache_creation_input_tokens,
      cache_read_input_tokens = excluded.cache_read_input_tokens
  `);

  const insertMany = db.transaction((msgs: Message[]) => {
    for (const msg of msgs) {
      stmt.run(
        msg.externalId,
        msg.sessionId,
        msg.subagentId,
        msg.timestamp,
        msg.model,
        msg.inputTokens,
        msg.outputTokens,
        msg.cacheCreationInputTokens,
        msg.cacheReadInputTokens
      );
    }
    return msgs.length;
  });

  return insertMany(messages);
}

export function getSyncState(filePath: string): { lastOffset: number } | null {
  const db = getDb();
  const row = db
    .prepare('SELECT last_offset FROM sync_state WHERE file_path = ?')
    .get(filePath) as { last_offset: number } | undefined;
  return row ? { lastOffset: row.last_offset } : null;
}

export function updateSyncState(filePath: string, lastOffset: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_state (file_path, last_offset, last_synced)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(file_path) DO UPDATE SET
      last_offset = excluded.last_offset,
      last_synced = datetime('now')
  `).run(filePath, lastOffset);
}

export interface SessionStats {
  id: number;
  externalId: string;
  project: string | null;
  startTime: string | null;
  endTime: string | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
  subagentCount: number;
}

export function getSessionStats(from?: string, to?: string): SessionStats[] {
  const db = getDb();
  let query = `
    SELECT
      s.id,
      s.external_id as externalId,
      s.project,
      s.start_time as startTime,
      s.end_time as endTime,
      COALESCE(SUM(m.input_tokens), 0) as inputTokens,
      COALESCE(SUM(m.cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(m.cache_read_input_tokens), 0) as cacheReadTokens,
      COALESCE(SUM(m.output_tokens), 0) as outputTokens,
      COUNT(m.id) as messageCount,
      COALESCE(SUM(${MESSAGE_COST_SQL}), 0) as estimatedCostUsd,
      (SELECT COUNT(*) FROM subagents sa WHERE sa.session_id = s.id) as subagentCount
    FROM sessions s
    LEFT JOIN messages m ON s.id = m.session_id
  `;

  const params: string[] = [];
  const conditions: string[] = ["s.external_id NOT LIKE 'agent-%'"];

  if (from) {
    conditions.push('s.start_time >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('s.start_time <= ?');
    params.push(to);
  }

  query += ' WHERE ' + conditions.join(' AND ');

  query += ' GROUP BY s.id ORDER BY s.start_time DESC';

  return db.prepare(query).all(...params) as SessionStats[];
}

export interface DailyStats {
  date: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
  sessionCount: number;
  messageCount: number;
}

export function getDailyStats(from?: string, to?: string): DailyStats[] {
  const db = getDb();
  let query = `
    SELECT
      date(m.timestamp) as date,
      COALESCE(SUM(m.input_tokens), 0) as inputTokens,
      COALESCE(SUM(m.cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(m.cache_read_input_tokens), 0) as cacheReadTokens,
      COALESCE(SUM(m.output_tokens), 0) as outputTokens,
      COUNT(DISTINCT m.session_id) as sessionCount,
      COUNT(m.id) as messageCount,
      COALESCE(SUM(${MESSAGE_COST_SQL}), 0) as costUsd
    FROM messages m
  `;

  const params: string[] = [];
  const conditions: string[] = [];

  if (from) {
    conditions.push('date(m.timestamp) >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('date(m.timestamp) <= ?');
    params.push(to);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' GROUP BY date(m.timestamp) ORDER BY date DESC';

  return db.prepare(query).all(...params) as DailyStats[];
}

export interface Summary {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  sessionCount: number;
  firstSession: string | null;
  lastSession: string | null;
}

export function getSummary(): Summary {
  const db = getDb();

  const stats = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(m.input_tokens), 0) as inputTokens,
      COALESCE(SUM(m.cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(m.cache_read_input_tokens), 0) as cacheReadTokens,
      COALESCE(SUM(m.output_tokens), 0) as outputTokens,
      COALESCE(SUM(${MESSAGE_COST_SQL}), 0) as totalCostUsd
    FROM messages m
  `
    )
    .get() as {
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };

  const sessionStats = db
    .prepare(
      `
    SELECT
      COUNT(*) as sessionCount,
      MIN(start_time) as firstSession,
      MAX(start_time) as lastSession
    FROM sessions
    WHERE external_id NOT LIKE 'agent-%'
  `
    )
    .get() as {
    sessionCount: number;
    firstSession: string | null;
    lastSession: string | null;
  };

  return {
    ...stats,
    sessionCount: sessionStats.sessionCount,
    firstSession: sessionStats.firstSession
      ? sessionStats.firstSession.split('T')[0]
      : null,
    lastSession: sessionStats.lastSession
      ? sessionStats.lastSession.split('T')[0]
      : null,
  };
}

export interface SubagentStats {
  id: number;
  externalId: string;
  type: string | null;
  startTime: string | null;
  endTime: string | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
}

export function getSubagentsBySessionId(sessionId: number): SubagentStats[] {
  const db = getDb();
  const query = `
    SELECT
      sa.id,
      sa.external_id as externalId,
      sa.type,
      sa.start_time as startTime,
      sa.end_time as endTime,
      COALESCE(SUM(m.input_tokens), 0) as inputTokens,
      COALESCE(SUM(m.cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(m.cache_read_input_tokens), 0) as cacheReadTokens,
      COALESCE(SUM(m.output_tokens), 0) as outputTokens,
      COUNT(m.id) as messageCount,
      COALESCE(SUM(${MESSAGE_COST_SQL}), 0) as estimatedCostUsd
    FROM subagents sa
    LEFT JOIN messages m ON sa.id = m.subagent_id
    WHERE sa.session_id = ?
    GROUP BY sa.id
    ORDER BY sa.start_time ASC
  `;
  return db.prepare(query).all(sessionId) as SubagentStats[];
}

export function cleanupOrphanedSubagentSessions(): void {
  const db = getDb();
  // Delete messages for sessions whose external_id looks like a subagent
  // (these were incorrectly parsed as sessions before subagent routing)
  db.prepare(`
    DELETE FROM messages WHERE session_id IN (
      SELECT id FROM sessions WHERE external_id LIKE 'agent-%'
    )
  `).run();
  // Delete the orphaned session entries themselves
  db.prepare(`DELETE FROM sessions WHERE external_id LIKE 'agent-%'`).run();
}

export function clearSessionMessages(sessionId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
}

export function clearSessionMessagesByExternalId(externalId: string): void {
  const db = getDb();
  const sessionId = getSessionIdByExternalId(externalId);
  if (sessionId !== null) {
    clearSessionMessages(sessionId);
  }
}
