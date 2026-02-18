import { getDb } from './schema.js';

const GAP_THRESHOLD_SECONDS = 1800;

// Per-message cost calculation in SQL
// Pricing per 1M tokens (USD) - https://claude.com/pricing
// Cache write = 125% of base input, Cache read = 10% of base input
// Sonnet 4.5 has tiered pricing: >200K input context uses higher rates
// CASE order matters: more specific patterns (e.g. sonnet-4-5) must come before
// broader ones (e.g. sonnet-4) since both would match the broader pattern

// Hypothetical cost if cache reads were charged at full input rate (no caching discount)
const MESSAGE_COST_NO_CACHE_SQL = `
  CASE
    WHEN m.model LIKE 'claude-sonnet-4-5%' AND
         (m.input_tokens + m.cache_creation_input_tokens + m.cache_read_input_tokens) > 200000 THEN
      (m.input_tokens * 6.0 + m.cache_creation_input_tokens * 6.0 + m.cache_read_input_tokens * 6.0 + m.output_tokens * 22.5) / 1000000.0
    WHEN m.model LIKE 'claude-sonnet-4-5%' THEN
      (m.input_tokens * 3.0 + m.cache_creation_input_tokens * 3.0 + m.cache_read_input_tokens * 3.0 + m.output_tokens * 15.0) / 1000000.0
    WHEN m.model LIKE 'claude-opus-4-5%' THEN
      (m.input_tokens * 5.0 + m.cache_creation_input_tokens * 5.0 + m.cache_read_input_tokens * 5.0 + m.output_tokens * 25.0) / 1000000.0
    WHEN m.model LIKE 'claude-haiku-4-5%' THEN
      (m.input_tokens * 1.0 + m.cache_creation_input_tokens * 1.0 + m.cache_read_input_tokens * 1.0 + m.output_tokens * 5.0) / 1000000.0
    WHEN m.model LIKE 'claude-sonnet-4%' THEN
      (m.input_tokens * 3.0 + m.cache_creation_input_tokens * 3.0 + m.cache_read_input_tokens * 3.0 + m.output_tokens * 15.0) / 1000000.0
    ELSE
      (m.input_tokens * 3.0 + m.cache_creation_input_tokens * 3.0 + m.cache_read_input_tokens * 3.0 + m.output_tokens * 15.0) / 1000000.0
  END
`;

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
  customTitle: string | null;
}

export interface UsageRecord {
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

export interface Exchange {
  sessionId: number;
  userMessageUuid: string | null;
  userTimestamp: string;
  assistantMessageId: string | null;
  assistantLastTimestamp: string | null;
  durationSeconds: number | null;
  userContent: string | null;
}

export function upsertSession(session: Session): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sessions (external_id, project, start_time, end_time, model, version, custom_title)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
      version = COALESCE(excluded.version, version),
      custom_title = COALESCE(excluded.custom_title, custom_title)
    RETURNING id
  `);
  const result = stmt.get(
    session.externalId,
    session.project,
    session.startTime,
    session.endTime,
    session.model,
    session.version,
    session.customTitle
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

export function insertUsageRecords(records: UsageRecord[]): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO usage_records (
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

  const insertMany = db.transaction((items: UsageRecord[]) => {
    for (const rec of items) {
      stmt.run(
        rec.externalId,
        rec.sessionId,
        rec.subagentId,
        rec.timestamp,
        rec.model,
        rec.inputTokens,
        rec.outputTokens,
        rec.cacheCreationInputTokens,
        rec.cacheReadInputTokens
      );
    }
    return items.length;
  });

  return insertMany(records);
}

export function insertExchanges(exchanges: Exchange[]): number {
  if (exchanges.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO exchanges (
      session_id, user_message_uuid, user_timestamp,
      assistant_message_id, assistant_last_timestamp,
      duration_seconds, user_content
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, user_timestamp) DO UPDATE SET
      assistant_message_id = excluded.assistant_message_id,
      assistant_last_timestamp = excluded.assistant_last_timestamp,
      duration_seconds = excluded.duration_seconds,
      user_content = excluded.user_content
  `);

  const insertMany = db.transaction((items: Exchange[]) => {
    for (const ex of items) {
      stmt.run(
        ex.sessionId,
        ex.userMessageUuid,
        ex.userTimestamp,
        ex.assistantMessageId,
        ex.assistantLastTimestamp,
        ex.durationSeconds,
        ex.userContent
      );
    }
    return items.length;
  });

  return insertMany(exchanges);
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
  customTitle: string | null;
  startTime: string | null;
  endTime: string | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
  subagentCount: number;
  durationSeconds: number;
  claudeActiveSeconds: number;
}

export function getSessionStats(from?: string, to?: string, project?: string, customTitle?: string): SessionStats[] {
  const db = getDb();
  let query = `
    SELECT
      s.id,
      s.external_id as externalId,
      s.project,
      s.custom_title as customTitle,
      s.start_time as startTime,
      s.end_time as endTime,
      COALESCE(SUM(m.input_tokens), 0) as inputTokens,
      COALESCE(SUM(m.cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(m.cache_read_input_tokens), 0) as cacheReadTokens,
      COALESCE(SUM(m.output_tokens), 0) as outputTokens,
      COUNT(m.id) as messageCount,
      COALESCE(SUM(${MESSAGE_COST_SQL}), 0) as estimatedCostUsd,
      (SELECT COUNT(*) FROM subagents sa WHERE sa.session_id = s.id) as subagentCount,
      (
        SELECT COALESCE(SUM(bsec), 0)
        FROM (
          SELECT (julianday(MAX(a_ts)) - julianday(MIN(u_ts))) * 86400 as bsec
          FROM (
            SELECT user_timestamp as u_ts, assistant_last_timestamp as a_ts,
              SUM(is_new_block) OVER (ORDER BY user_timestamp) as bid
            FROM (
              SELECT user_timestamp, assistant_last_timestamp,
                CASE
                  WHEN LAG(assistant_last_timestamp) OVER (ORDER BY user_timestamp) IS NULL
                    OR (julianday(user_timestamp) - julianday(LAG(assistant_last_timestamp) OVER (ORDER BY user_timestamp))) * 86400 > ${GAP_THRESHOLD_SECONDS}
                  THEN 1 ELSE 0
                END as is_new_block
              FROM exchanges
              WHERE session_id = s.id AND assistant_last_timestamp IS NOT NULL
            )
          )
          GROUP BY bid
        )
      ) as durationSeconds,
      (SELECT COALESCE(SUM(duration_seconds), 0) FROM exchanges WHERE session_id = s.id) as claudeActiveSeconds
    FROM sessions s
    LEFT JOIN usage_records m ON s.id = m.session_id
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
  if (project) {
    conditions.push('s.project = ?');
    params.push(project);
  }
  if (customTitle) {
    conditions.push('s.custom_title = ?');
    params.push(customTitle);
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

export function getDailyStats(from?: string, to?: string, project?: string, customTitle?: string): DailyStats[] {
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
    FROM usage_records m
  `;

  const params: string[] = [];
  const conditions: string[] = [];

  if (project || customTitle) {
    query += ' JOIN sessions s ON s.id = m.session_id';
    if (project) {
      conditions.push('s.project = ?');
      params.push(project);
    }
    if (customTitle) {
      conditions.push('s.custom_title = ?');
      params.push(customTitle);
    }
  }

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
  costWithoutCacheUsd: number;
  sessionCount: number;
  messageCount: number;
  totalHours: number;
  claudeActiveHours: number;
  firstSession: string | null;
  lastSession: string | null;
}

export function getSummary(from?: string, to?: string, project?: string, customTitle?: string): Summary {
  const db = getDb();

  const needsJoin = project || customTitle;
  const sessionJoin = needsJoin ? ' JOIN sessions s ON s.id = m.session_id' : '';
  const statsConditions: string[] = [];
  const statsParams: string[] = [];
  if (project) {
    statsConditions.push('s.project = ?');
    statsParams.push(project);
  }
  if (customTitle) {
    statsConditions.push('s.custom_title = ?');
    statsParams.push(customTitle);
  }
  if (from) {
    statsConditions.push('date(m.timestamp) >= ?');
    statsParams.push(from);
  }
  if (to) {
    statsConditions.push('date(m.timestamp) <= ?');
    statsParams.push(to);
  }
  const statsWhere = statsConditions.length > 0 ? ' WHERE ' + statsConditions.join(' AND ') : '';

  const stats = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(m.input_tokens), 0) as inputTokens,
      COALESCE(SUM(m.cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(m.cache_read_input_tokens), 0) as cacheReadTokens,
      COALESCE(SUM(m.output_tokens), 0) as outputTokens,
      COALESCE(SUM(${MESSAGE_COST_SQL}), 0) as totalCostUsd,
      COALESCE(SUM(${MESSAGE_COST_NO_CACHE_SQL}), 0) as costWithoutCacheUsd,
      COUNT(m.id) as messageCount
    FROM usage_records m${sessionJoin}${statsWhere}
  `
    )
    .get(...statsParams) as {
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    totalCostUsd: number;
    costWithoutCacheUsd: number;
    messageCount: number;
  };

  // Session count + date range query
  const sessionConditions = ["s.external_id NOT LIKE 'agent-%'"];
  const sessionParams: string[] = [];
  if (project) {
    sessionConditions.push('s.project = ?');
    sessionParams.push(project);
  }
  if (customTitle) {
    sessionConditions.push('s.custom_title = ?');
    sessionParams.push(customTitle);
  }
  if (from) {
    sessionConditions.push('s.start_time >= ?');
    sessionParams.push(from);
  }
  if (to) {
    sessionConditions.push('s.start_time <= ?');
    sessionParams.push(to);
  }

  const sessionStats = db
    .prepare(
      `
    SELECT
      COUNT(*) as sessionCount,
      MIN(s.start_time) as firstSession,
      MAX(s.start_time) as lastSession
    FROM sessions s
    WHERE ${sessionConditions.join(' AND ')}
  `
    )
    .get(...sessionParams) as {
    sessionCount: number;
    firstSession: string | null;
    lastSession: string | null;
  };

  // Total active hours via gap-threshold block-based calculation
  const hoursResult = db
    .prepare(
      `
    WITH ordered AS (
      SELECT e.session_id, e.user_timestamp, e.assistant_last_timestamp,
        LAG(e.assistant_last_timestamp) OVER (PARTITION BY e.session_id ORDER BY e.user_timestamp) as prev_end
      FROM exchanges e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.assistant_last_timestamp IS NOT NULL AND ${sessionConditions.join(' AND ')}
    ),
    block_marked AS (
      SELECT session_id, user_timestamp, assistant_last_timestamp,
        SUM(CASE
          WHEN prev_end IS NULL OR (julianday(user_timestamp) - julianday(prev_end)) * 86400 > ${GAP_THRESHOLD_SECONDS}
          THEN 1 ELSE 0
        END) OVER (PARTITION BY session_id ORDER BY user_timestamp) as block_id
      FROM ordered
    ),
    blocks AS (
      SELECT (julianday(MAX(assistant_last_timestamp)) - julianday(MIN(user_timestamp))) * 86400 as block_seconds
      FROM block_marked GROUP BY session_id, block_id
    )
    SELECT COALESCE(SUM(block_seconds), 0) / 3600.0 as totalHours
    FROM blocks
  `
    )
    .get(...sessionParams) as { totalHours: number };

  const claudeActiveResult = db
    .prepare(
      `
    SELECT COALESCE(SUM(e.duration_seconds), 0) / 3600.0 as claudeActiveHours
    FROM exchanges e
    JOIN sessions s ON s.id = e.session_id
    WHERE ${sessionConditions.join(' AND ')}
  `
    )
    .get(...sessionParams) as { claudeActiveHours: number };

  return {
    ...stats,
    sessionCount: sessionStats.sessionCount,
    totalHours: hoursResult.totalHours,
    claudeActiveHours: claudeActiveResult.claudeActiveHours,
    firstSession: sessionStats.firstSession
      ? sessionStats.firstSession.split('T')[0]
      : null,
    lastSession: sessionStats.lastSession
      ? sessionStats.lastSession.split('T')[0]
      : null,
  };
}

export function getProjects(): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT project FROM sessions WHERE project IS NOT NULL AND external_id NOT LIKE 'agent-%' ORDER BY project`
    )
    .all() as { project: string }[];
  return rows.map((r) => r.project);
}

export function getCustomTitles(): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT custom_title FROM sessions WHERE custom_title IS NOT NULL AND external_id NOT LIKE 'agent-%' ORDER BY custom_title`
    )
    .all() as { custom_title: string }[];
  return rows.map((r) => r.custom_title);
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
    LEFT JOIN usage_records m ON sa.id = m.subagent_id
    WHERE sa.session_id = ?
    GROUP BY sa.id
    ORDER BY sa.start_time ASC
  `;
  return db.prepare(query).all(sessionId) as SubagentStats[];
}

export interface MonthlyCost {
  month: string;
  apiCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionCount: number;
  messageCount: number;
}

export function getMonthlyCosts(from?: string, to?: string, project?: string, customTitle?: string): MonthlyCost[] {
  const db = getDb();
  let query = `
    SELECT
      strftime('%Y-%m', m.timestamp) as month,
      COALESCE(SUM(${MESSAGE_COST_SQL}), 0) as apiCostUsd,
      COALESCE(SUM(m.input_tokens), 0) as inputTokens,
      COALESCE(SUM(m.output_tokens), 0) as outputTokens,
      COALESCE(SUM(m.cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(m.cache_read_input_tokens), 0) as cacheReadTokens,
      COUNT(DISTINCT m.session_id) as sessionCount,
      COUNT(m.id) as messageCount
    FROM usage_records m
  `;

  const params: string[] = [];
  const conditions: string[] = [];

  if (project || customTitle) {
    query += ' JOIN sessions s ON s.id = m.session_id';
    if (project) {
      conditions.push('s.project = ?');
      params.push(project);
    }
    if (customTitle) {
      conditions.push('s.custom_title = ?');
      params.push(customTitle);
    }
  }

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

  query += " GROUP BY strftime('%Y-%m', m.timestamp) ORDER BY month ASC";

  return db.prepare(query).all(...params) as MonthlyCost[];
}

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string | null): void {
  const db = getDb();
  if (value === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function cleanupOrphanedSubagentSessions(): void {
  const db = getDb();
  // Delete usage_records for sessions whose external_id looks like a subagent
  // (these were incorrectly parsed as sessions before subagent routing)
  db.prepare(`
    DELETE FROM usage_records WHERE session_id IN (
      SELECT id FROM sessions WHERE external_id LIKE 'agent-%'
    )
  `).run();
  // Delete the orphaned session entries themselves
  db.prepare(`DELETE FROM sessions WHERE external_id LIKE 'agent-%'`).run();
}

export function updateSessionCustomTitle(sessionId: number, customTitle: string | null): void {
  const db = getDb();
  db.prepare('UPDATE sessions SET custom_title = ? WHERE id = ?').run(customTitle, sessionId);
}

export function deleteSession(sessionId: number): void {
  const db = getDb();
  const del = db.transaction(() => {
    db.prepare('DELETE FROM usage_records WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM exchanges WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM subagents WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  });
  del();
}

export function clearSessionUsageRecords(sessionId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM usage_records WHERE session_id = ?').run(sessionId);
}

export function clearSessionUsageRecordsByExternalId(externalId: string): void {
  const db = getDb();
  const sessionId = getSessionIdByExternalId(externalId);
  if (sessionId !== null) {
    clearSessionUsageRecords(sessionId);
  }
}

export function clearSessionExchanges(sessionId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM exchanges WHERE session_id = ?').run(sessionId);
}

export function clearSessionExchangesByExternalId(externalId: string): void {
  const db = getDb();
  const sessionId = getSessionIdByExternalId(externalId);
  if (sessionId !== null) {
    clearSessionExchanges(sessionId);
  }
}
