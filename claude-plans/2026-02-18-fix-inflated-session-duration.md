# Plan: Fix Inflated Session Duration + Schema Improvements

## Context

The `totalHours` stat and per-session duration column are wildly inflated for sessions that were resumed after a long break. The current implementation uses `end_time - start_time` from the `sessions` table, where `start_time`/`end_time` are the min/max timestamps across ALL lines in the JSONL file — including `/exit` command meta-lines appended hours later.

**Confirmed across 6 session files:** every JSONL follows a consistent turn pattern:
1. `type: "user"` line — user sends message, has `timestamp`
2. One or more `type: "assistant"` lines with `usage` key — streaming chunks sharing the same `message.id`, last one wins (already deduplicated by parser)
3. Next `type: "user"` line = clean turn boundary

This means turn duration = `last assistant timestamp - user timestamp`, and summing these gives accurate active time with no arbitrary threshold needed.

**Additionally:** the `messages` table is misnamed — it only stores assistant messages with usage data, not a general conversation log. This is being cleaned up as part of this work.

---

## Schema Changes

### 1. Rename `messages` → `usage_records`
No structural changes — same columns, same data — just an honest name. Reflects that it stores billable API call records, not general messages.

### 2. Add `exchanges` table
One row per conversation turn (user message → Claude response):

```sql
CREATE TABLE IF NOT EXISTS exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_message_uuid TEXT NOT NULL,
  user_timestamp TEXT NOT NULL,
  assistant_message_id TEXT,         -- references usage_records.external_id
  assistant_last_timestamp TEXT,
  duration_seconds REAL,
  user_content TEXT
);

CREATE INDEX IF NOT EXISTS idx_exchanges_session ON exchanges(session_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_user_timestamp ON exchanges(user_timestamp);
```

**What this unlocks beyond the duration fix:**
- Per-turn cost breakdown (join `exchanges` → `usage_records`)
- Average response time per session / overall
- Conversation history display
- Search across user prompts

---

## Files to Change

### `src/server/db/schema.ts`
- Rename `messages` table definition → `usage_records`
- Rename all three `idx_messages_*` indexes → `idx_usage_records_*`
- Add `exchanges` table and its indexes

### `src/server/db/queries.ts`
- All SQL: `FROM messages` / `JOIN messages` / `DELETE FROM messages` / `INSERT INTO messages` → `usage_records`
- Rename exported functions:
  - `insertMessages` → `insertUsageRecords`
  - `clearSessionMessages` → `clearSessionUsageRecords`
  - `clearSessionMessagesByExternalId` → `clearSessionUsageRecordsByExternalId`
- Rename exported `Message` type → `UsageRecord`
- **`getSummary()`**: replace `julianday(end_time) - julianday(start_time)` totalHours calculation with:
  ```sql
  COALESCE(SUM(e.duration_seconds), 0) / 3600.0 as totalHours
  FROM exchanges e
  JOIN sessions s ON s.id = e.session_id
  -- same WHERE filters applied via sessions join
  ```
- **`getSessions()`**: add `durationSeconds` field per session via subquery:
  ```sql
  (SELECT COALESCE(SUM(duration_seconds), 0) FROM exchanges WHERE session_id = s.id) as durationSeconds
  ```
- Add `insertExchanges` and `insertExchange` functions
- Update `messageCount` in getSummary/getSessions to count from `usage_records`

### `src/server/parser/jsonl.ts`
- Update imports: `insertMessages` → `insertUsageRecords`, etc.
- Add turn-tracking logic to `parseSessionFile()`:
  ```
  let turnStart: string | null = null
  let turnEnd: string | null = null
  const exchangesList = []

  for each line:
    if type == "user" (not isMeta):
      if turnStart && turnEnd:
        exchangesList.push({ user_timestamp: turnStart, assistant_last_timestamp: turnEnd,
                             duration_seconds: diff, user_content, ... })
      turnStart = line.timestamp
      turnEnd = null
    if type == "assistant" with usage:
      turnEnd = line.timestamp  (last one wins)

  // flush final turn
  if turnStart && turnEnd:
    exchangesList.push(...)

  insertExchanges(exchangesList)
  ```
- Rename `messagesImported` → `usageRecordsImported` in return values and interfaces
- Add `exchangesImported` count to return values

### `src/server/routes/sync.ts`
- Update response properties: `messagesImported` → `usageRecordsImported`

### `src/client/components/Dashboard.tsx`
- Update sync success message: `"Imported X messages"` → `"Imported X usage records"`

### `src/client/components/SessionList.tsx`
- Session rows now include `durationSeconds` from the query
- Replace `formatDuration(session.startTime, session.endTime)` with a formatter that uses `durationSeconds`
- `startTime`/`endTime` can remain on the row for display purposes (started/ended columns), just not used for duration

### `src/server/db/queries.test.ts` + `src/server/parser/jsonl.test.ts`
- Rename all `messages` SQL references → `usage_records`
- Rename all `insertMessages` calls → `insertUsageRecords`
- Rename `messagesImported` assertions → `usageRecordsImported`
- Add tests for `exchanges` insertion and `duration_seconds` calculation

### `src/server/test/fixtures.ts`
- Add a real multi-turn JSONL excerpt as a fixture (at least 2 full user→assistant turns with usage, including streaming chunks) to serve as a format regression test

---

## Format Change Detection

Two lightweight guards against future Claude Code JSONL format changes breaking the turn pattern:

### 1. Parse-time warning
After parsing each file, if `usageRecords > 0` but `exchanges === 0`, log a warning:
```
console.warn(`[parser] No exchanges detected in ${filePath} despite ${usageRecordsCount} usage records — JSONL format may have changed`)
```
This immediately surfaces if the user→assistant pattern stops being detected.

### 2. Fixture-based regression test
Add a test in `jsonl.test.ts` using a real multi-turn session excerpt (stored in `fixtures.ts`) that asserts:
- Correct number of exchanges created
- Correct `duration_seconds` values per turn
- Correct `user_content` captured
- Correct `usageRecordsImported` count

If Claude Code changes its JSONL format, this test fails before bad data ever reaches the DB.

---

## Migration / Re-sync

SQLite cannot rename tables directly via `ALTER TABLE` (requires re-create). Options:
1. **Full DB wipe + re-sync** — simplest, data comes from JSONL files anyway so nothing is lost
2. **Migration script** — `CREATE TABLE usage_records AS SELECT * FROM messages`, then `DROP TABLE messages`, rebuild indexes, create `exchanges` and run a re-sync to populate it

Option 1 is recommended — the source of truth is always the JSONL files, so a re-sync is safe and fast.

---

## Verification
1. Session eef8a26d: duration should show ~35 min (not 22h 48m)
2. Session 7b35730b: duration should show ~25 min (not 22h 42m)
3. Aggregate `totalHours` should reflect actual active time across all sessions
4. Sessions with no gaps should be unaffected
5. `exchanges` table populated with correct turn counts after re-sync
6. All existing tests pass with renamed references

---

## Implementation Checklist

### Schema (`src/server/db/schema.ts`)
- [x] Rename `messages` table → `usage_records`
- [x] Rename `idx_messages_session` → `idx_usage_records_session`
- [x] Rename `idx_messages_timestamp` → `idx_usage_records_timestamp`
- [x] Rename `idx_messages_external_id` → `idx_usage_records_external_id`
- [x] Add `exchanges` table with `UNIQUE(session_id, user_timestamp)` constraint
- [x] Add `idx_exchanges_session` and `idx_exchanges_user_timestamp` indexes
- [x] Add migration: `DROP TABLE IF EXISTS messages` on startup

### Queries (`src/server/db/queries.ts`)
- [x] Rename `Message` type → `UsageRecord`
- [x] Rename `insertMessages` → `insertUsageRecords`; all SQL `messages` → `usage_records`
- [x] Rename `clearSessionMessages` → `clearSessionUsageRecords`
- [x] Rename `clearSessionMessagesByExternalId` → `clearSessionUsageRecordsByExternalId`
- [x] Add `Exchange` interface
- [x] Add `insertExchanges` function (with `ON CONFLICT DO UPDATE` upsert)
- [x] Add `clearSessionExchanges` and `clearSessionExchangesByExternalId`
- [x] Add `durationSeconds` subquery to `getSessionStats`
- [x] Fix `getSummary` `totalHours`: replaced wall-clock julianday calc with `SUM(e.duration_seconds) / 3600` via exchanges join
- [x] Update `deleteSession` to also delete from `exchanges`
- [x] Update `cleanupOrphanedSubagentSessions` to use `usage_records`
- [x] Update all other SQL (`getDailyStats`, `getMonthlyCosts`, `getSubagentsBySessionId`)

### Parser (`src/server/parser/jsonl.ts`)
- [x] Update imports to renamed functions/types
- [x] Add `isMeta` and `isSidechain` fields to `JsonlLine` interface
- [x] Add `extractUserContent` helper for string/array content
- [x] Add turn-tracking state (`turnStart`, `turnEnd`, `lastAssistantMsgId`, `exchangesList`)
- [x] Detect real user turns (skip `isMeta`, `isSidechain`)
- [x] Flush completed turns on each new user line; flush final turn after loop
- [x] Clear exchanges on full sync (`clearSessionExchangesByExternalId`)
- [x] Insert exchanges after session upsert with correct `sessionId`
- [x] Add format-change warning when `usageRecords > 0` but `exchanges === 0`
- [x] Rename `messagesImported` → `usageRecordsImported` in `ParseResult` and all return sites
- [x] Add `exchangesImported` to `ParseResult`
- [x] Update `syncAllSessions` return type

### Routes (`src/server/routes/sync.ts`)
- [x] `messagesImported` → `usageRecordsImported` in single-session response
- [x] `messagesImported` → `usageRecordsImported` in sync-all response

### Client (`src/client/components/Dashboard.tsx`)
- [x] Sync status message: "Imported X usage records from Y sessions"

### Client (`src/client/components/SessionList.tsx`)
- [x] Add `durationSeconds: number` to `Session` interface
- [x] Add `formatDurationSeconds(seconds)` helper
- [x] Replace `formatDuration(startTime, endTime)` with `formatDurationSeconds(durationSeconds)` in session rows

### Tests (`src/server/db/queries.test.ts`)
- [x] Rename `insertMessages` → `insertUsageRecords` throughout
- [x] Rename SQL `FROM messages` → `FROM usage_records`
- [x] Add `insertExchanges` import
- [x] Add `insertExchanges` describe block (insert, upsert on conflict, empty array)
- [x] Add `durationSeconds from exchanges` test in `getSessionStats`
- [x] Add `totalHours from exchanges` test in `getSummary`
- [x] Add `totalHours is 0 when no exchanges` test in `getSummary`

### Tests (`src/server/parser/jsonl.test.ts`)
- [x] Rename `messagesImported` → `usageRecordsImported` throughout
- [x] Rename `FROM messages` → `FROM usage_records` in inline SQL
- [x] Add `MULTI_TURN_JSONL` import
- [x] Add `parseSessionFile - exchange tracking` describe block with 7 tests:
  - [x] Correct exchange count (3 exchanges, 3 usage records, streaming dedup)
  - [x] Correct `duration_seconds` per turn (12s, 15s, 30s)
  - [x] `user_content` captured correctly
  - [x] Streaming dedup reflected in exchange's `assistant_message_id`
  - [x] `BASIC_SESSION_JSONL` creates 2 exchanges
  - [x] Re-parse (full sync) does not duplicate exchanges
  - [x] `isMeta` user lines not counted as turn starts
- [x] Add `subagent file does not create exchanges` test

### Fixtures (`src/server/test/fixtures.ts`)
- [x] Add `MULTI_TURN_JSONL`: 3 user→assistant turns, streaming chunks on turn 1, known durations (12s / 15s / 30s)

### Migration
- [x] Implemented via `DROP TABLE IF EXISTS messages` in `initializeSchema` (schema-level auto-migration)
- [x] Wipe `data/usage.db` and run "Sync All Sessions" to populate `exchanges` with real data (122 sessions, 2417 usage records, 1838 exchanges, 3.67h total active time)
