# Add Tests to Verify Usage Tracking

## Context
No tests exist yet (listed as TODO in README). The goal is to verify that Claude Code usage is correctly tracked: JSONL parsing, token aggregation, cost calculations, and DB queries all produce correct numbers. We'll use in-memory SQLite (better-sqlite3 supports `:memory:`) for fast, isolated tests.

## Approach
- **Framework**: Vitest (natural fit since Vite is already in the project; handles ESM + TypeScript natively)
- **DB strategy**: Add a single `setDb()` function to `schema.ts` to allow injecting an in-memory database. All query functions already call `getDb()` which returns the singleton, so no other production code changes needed.
- **Test types**: Unit tests for pure functions + integration tests for the parse-to-DB-to-query pipeline

## Files to Create

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Separate from client vite.config.ts (which has root: 'src/client' and React plugin) |
| `src/server/test/setup.ts` | `setupTestDb()` / `teardownTestDb()` helpers using `:memory:` DB |
| `src/server/test/fixtures.ts` | JSONL test data constants (various models, streaming dedup, subagents, etc.) |
| `src/server/parser/jsonl.test.ts` | Parser unit + integration tests (~18 tests) |
| `src/server/db/queries.test.ts` | DB query and cost calculation tests (~20 tests) |

## Files to Modify

| File | Change |
|------|--------|
| `src/server/db/schema.ts` | Add `setDb(database)` function (4 lines) |
| `package.json` | Add `vitest` devDependency + `"test"` / `"test:watch"` scripts |

## Test Coverage

### Parser tests (`jsonl.test.ts`)
- **Pure functions**: `isSubagentFile`, `extractProjectFromPath`, `extractSessionExternalIdFromPath`, `extractParentSessionExternalId`
- **Integration**: Basic session parse -> DB verify, streaming message deduplication (same ID appears multiple times, last wins), skipping `file-history-snapshot` lines, handling invalid JSON gracefully, custom title extraction, sync state tracking, incremental sync, upsert idempotency, subagent parsing + parent linking

### Query tests (`queries.test.ts`)
- **CRUD**: `upsertSession` insert + update semantics (keeps earliest start, latest end), `insertMessages` bulk + upsert on conflict
- **Cost calculations** (all 5 pricing tiers with hand-calculated expected values):
  - Sonnet 4: input=$3, cache_write=$3.75, cache_read=$0.30, output=$15
  - Sonnet 4.5 (<=200K context): $3/$3.75/$0.30/$15
  - Sonnet 4.5 (>200K context): $6/$7.50/$0.60/$22.50
  - Opus 4.5: $5/$6.25/$0.50/$25
  - Haiku 4.5: $1/$1.25/$0.10/$5
  - Unknown model falls through to default pricing
- **Aggregation**: `getSessionStats` with date/project/customTitle filters, agent-* exclusion, subagentCount; `getDailyStats` date grouping; `getSummary` totals + cache savings; `getProjects`/`getCustomTitles` distinct lists; `getSubagentsBySessionId`; `cleanupOrphanedSubagentSessions`

## Implementation Sequence

1. Install vitest: `npm install --save-dev vitest`
2. Add npm scripts: `"test": "vitest run"`, `"test:watch": "vitest"`
3. Create `vitest.config.ts` at project root
4. Modify `schema.ts` - add `setDb()` function
5. Create `src/server/test/setup.ts`
6. Create `src/server/test/fixtures.ts`
7. Create `src/server/db/queries.test.ts`
8. Create `src/server/parser/jsonl.test.ts`
9. Run `npm test` to verify

## Verification
```bash
npm test            # run all tests once
npm run test:watch  # watch mode during development
```

## Issues

No issues encountered during implementation. All 50 tests passed on the first run (170ms total):
- `queries.test.ts`: 28 tests passed
- `jsonl.test.ts`: 22 tests passed

The in-memory SQLite approach worked seamlessly -- the single `setDb()` addition to `schema.ts` was sufficient to redirect all DB operations to the test database without any other production code changes.
