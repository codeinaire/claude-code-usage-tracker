# Plan: Gap-Threshold Block Duration + Claude vs User Time Breakdown

## Context

The current `durationSeconds` / `totalHours` sums `exchange.duration_seconds` (response latency only = `last_assistant_ts - user_ts`). This ignores all time spent reading, thinking, and typing between turns.

**Gap-threshold blocks** give a more accurate picture of active engagement:
- Group consecutive exchanges into blocks where no gap between `prev_assistant_last_ts` and `next_user_ts` exceeds 30 min
- Block duration = `last_exchange_assistant_ts - first_exchange_user_ts`
- `durationSeconds` = sum of block durations (active engagement time)
- `claudeActiveSeconds` = sum of `exchange.duration_seconds` (response latency — unchanged metric)
- User time = `durationSeconds - claudeActiveSeconds`

**Session boundaries:** Claude Code defines a session as one invocation (run `claude` → exit). The existing `start_time` / `end_time` already capture this (min/max top-level timestamps in the JSONL). The session list already shows `Started` and `Ended` columns, so the full wall-clock session span remains visible. The `Duration` column changes semantic: it was "sum of response latencies"; it becomes "total active engagement time (block-based)."

For eef8a26d: Started `00:39`, Ended `23:27` (full Claude Code session span), Active `~34m` (two blocks), Claude `~1.7m`, You `~32m`.

## Threshold

`const GAP_THRESHOLD_SECONDS = 1800` — named constant added near top of `queries.ts`.

---

## SQL

### Block-based duration (correlated subquery for `getSessionStats`)

```sql
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
) as durationSeconds
```

### Claude active time per session (existing subquery, kept)

```sql
(SELECT COALESCE(SUM(duration_seconds), 0) FROM exchanges WHERE session_id = s.id) as claudeActiveSeconds
```

### Block-based total hours for `getSummary` (CTE, sessionConditions injected)

```sql
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
```

### Claude total hours for `getSummary` (second query, same sessionConditions/params)

```sql
SELECT COALESCE(SUM(e.duration_seconds), 0) / 3600.0 as claudeActiveHours
FROM exchanges e
JOIN sessions s ON s.id = e.session_id
WHERE ${sessionConditions.join(' AND ')}
```

---

## Files to Change

### `src/server/db/queries.ts`

1. Add after imports: `const GAP_THRESHOLD_SECONDS = 1800;`
2. **`SessionStats` interface**: add `claudeActiveSeconds: number`
3. **`getSessionStats()`**: replace `durationSeconds` subquery with block-based version; add `claudeActiveSeconds` subquery
4. **`Summary` interface**: add `claudeActiveHours: number`
5. **`getSummary()`**: replace `hoursResult` query with CTE block-based query; add second query for `claudeActiveHours`; include both in return value

### `src/client/components/AggregatedStatsCard.tsx`

- Add `claudeActiveHours: number` to local `Summary` interface
- In "Total Hours" card: add `cardSubvalue` showing `Claude: X · You: Y`
  - User hours = `totalHours - claudeActiveHours`
  - Format both with `formatHours()`

### `src/client/components/SessionList.tsx`

- Add `claudeActiveSeconds: number` to `Session` interface
- Add a small `InfoIcon` inline component (a styled `ⓘ` span with CSS `cursor: help` and a `title` prop) for use in column headers
- Update three `<th>` headers to include `<InfoIcon>` with tooltips:
  - **Started**: `"When this Claude Code session was opened (timestamp of the first message)"`
  - **Ended**: `"When this Claude Code session was closed (timestamp of the last message)"`
  - **Duration**: `"Total active engagement time, excluding gaps longer than 30 minutes. Breakdown shows Claude's response time vs your reading and typing time."`
- Duration cell: render breakdown subtext when `claudeActiveSeconds > 0`:
  ```tsx
  <td style={styles.tdRight}>
    {formatDurationSeconds(session.durationSeconds)}
    {session.claudeActiveSeconds > 0 && (
      <div style={{ fontSize: '11px', color: '#888' }}>
        Claude {formatDurationSeconds(session.claudeActiveSeconds)}
        {' · '}
        You {formatDurationSeconds(session.durationSeconds - session.claudeActiveSeconds)}
      </div>
    )}
  </td>
  ```

### `src/server/db/queries.test.ts`

- Add `claudeActiveSeconds` to `SessionStats` assertions
- Add `claudeActiveHours` to `Summary` assertions
- Update existing `durationSeconds` / `totalHours` expected values (now block-based, not latency sum)
- Add **gap > threshold test**: two exchanges with 31-min gap → two blocks, gap excluded
- Add **gap < threshold test**: two exchanges with 29-min gap → one block, full span counted

---

## What Stays the Same

- `exchange.duration_seconds` still stored and used as `claudeActiveSeconds` source
- No schema changes, no parser changes
- Session list `Started` / `Ended` columns unchanged — full wall-clock session span still visible
- `formatDurationSeconds` / `formatHours` helpers unchanged

---

## Verification

1. `npm test` — all tests pass
2. Session eef8a26d: Duration ~34m, Claude ~1.7m, You ~32m
3. "Total Hours" card shows subtext breakdown (e.g. "Claude: 2h · You: 32h")
4. Session list duration cells show Claude/You split beneath the total
5. Started/Ended columns still show the full Claude Code session boundaries

---

## Todo

- [x] Add `GAP_THRESHOLD_SECONDS = 1800` constant to `queries.ts`
- [x] Add `claudeActiveSeconds: number` to `SessionStats` interface
- [x] Replace `durationSeconds` subquery in `getSessionStats()` with block-based SQL
- [x] Add `claudeActiveSeconds` subquery to `getSessionStats()`
- [x] Add `claudeActiveHours: number` to `Summary` interface
- [x] Replace `hoursResult` in `getSummary()` with CTE block-based query
- [x] Add `claudeActiveHours` query to `getSummary()`
- [x] Add `claudeActiveHours` to `AggregatedStatsCard.tsx` Summary interface
- [x] Add Claude/You breakdown subtext to Total Hours card in `AggregatedStatsCard.tsx`
- [x] Add `claudeActiveSeconds` to `Session` interface in `SessionList.tsx`
- [x] Add `InfoIcon` component to `SessionList.tsx`
- [x] Add tooltips to Started/Ended/Duration column headers in `SessionList.tsx`
- [x] Add Claude/You breakdown subtext to Duration cell in `SessionList.tsx`
- [x] Update existing duration test in `queries.test.ts` to use block-based semantics
- [x] Add gap > threshold test (two blocks)
- [x] Add gap < threshold test (one block)
- [x] Update `getSummary` totalHours test for block-based semantics
- [x] Add `claudeActiveHours` assertions to `getSummary` tests
- [x] All 66 tests passing

## Implementation Notes

- Block-based `durationSeconds` uses `julianday()` arithmetic which has floating-point imprecision (~1e-5s). Tests use `toBeCloseTo(value, 0)` for block-duration assertions.
- `claudeActiveSeconds` (sum of `duration_seconds`) is exact integer arithmetic — uses `toBe()`.
