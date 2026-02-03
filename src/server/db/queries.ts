import { getDb } from './schema.js';

// Pricing per 1M tokens (USD) - https://claude.com/pricing
// Cache write = 125% of base input, Cache read = 10% of base input
const PRICING: Record<string, { input: number; cacheWrite: number; cacheRead: number; output: number }> = {
  'claude-opus-4-5-20251101': { input: 5, cacheWrite: 6.25, cacheRead: 0.50, output: 25 },
  'claude-sonnet-4-20250514': { input: 3, cacheWrite: 3.75, cacheRead: 0.30, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, cacheWrite: 1.25, cacheRead: 0.10, output: 5 },
};

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export interface TokenBreakdown {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export function calculateCost(
  model: string,
  tokens: TokenBreakdown
): number {
  const pricing = PRICING[model] || PRICING[DEFAULT_MODEL];
  return (
    tokens.inputTokens * pricing.input +
    tokens.cacheCreationTokens * pricing.cacheWrite +
    tokens.cacheReadTokens * pricing.cacheRead +
    tokens.outputTokens * pricing.output
  ) / 1_000_000;
}

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
      m.model
    FROM sessions s
    LEFT JOIN messages m ON s.id = m.session_id
  `;

  const params: string[] = [];
  const conditions: string[] = [];

  if (from) {
    conditions.push('s.start_time >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('s.start_time <= ?');
    params.push(to);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' GROUP BY s.id ORDER BY s.start_time DESC';

  const rows = db.prepare(query).all(...params) as Array<{
    id: number;
    externalId: string;
    project: string | null;
    startTime: string | null;
    endTime: string | null;
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    messageCount: number;
    model: string | null;
  }>;

  return rows.map((row) => ({
    ...row,
    estimatedCostUsd: calculateCost(row.model || DEFAULT_MODEL, {
      inputTokens: row.inputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      outputTokens: row.outputTokens,
    }),
  }));
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
      m.model
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

  const rows = db.prepare(query).all(...params) as Array<{
    date: string;
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    sessionCount: number;
    messageCount: number;
    model: string | null;
  }>;

  return rows.map((row) => ({
    ...row,
    costUsd: calculateCost(row.model || DEFAULT_MODEL, {
      inputTokens: row.inputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      outputTokens: row.outputTokens,
    }),
  }));
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

  const tokenStats = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(input_tokens), 0) as inputTokens,
      COALESCE(SUM(cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(cache_read_input_tokens), 0) as cacheReadTokens,
      COALESCE(SUM(output_tokens), 0) as outputTokens
    FROM messages
  `
    )
    .get() as {
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
  };

  const sessionStats = db
    .prepare(
      `
    SELECT
      COUNT(*) as sessionCount,
      MIN(start_time) as firstSession,
      MAX(start_time) as lastSession
    FROM sessions
  `
    )
    .get() as {
    sessionCount: number;
    firstSession: string | null;
    lastSession: string | null;
  };

  // Get predominant model for cost calculation
  const modelRow = db
    .prepare(
      `
    SELECT model, COUNT(*) as cnt
    FROM messages
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY cnt DESC
    LIMIT 1
  `
    )
    .get() as { model: string } | undefined;

  const model = modelRow?.model || DEFAULT_MODEL;

  return {
    inputTokens: tokenStats.inputTokens,
    cacheCreationTokens: tokenStats.cacheCreationTokens,
    cacheReadTokens: tokenStats.cacheReadTokens,
    outputTokens: tokenStats.outputTokens,
    totalCostUsd: calculateCost(model, tokenStats),
    sessionCount: sessionStats.sessionCount,
    firstSession: sessionStats.firstSession
      ? sessionStats.firstSession.split('T')[0]
      : null,
    lastSession: sessionStats.lastSession
      ? sessionStats.lastSession.split('T')[0]
      : null,
  };
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
