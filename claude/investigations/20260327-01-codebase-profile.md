# Claude Code Usage Tracker -- Codebase Profile

## Project Summary

**Project:** claude-code-usage-tracker
**Tech Stack:** TypeScript, Express.js 5, React 19, Vite 7, SQLite (better-sqlite3), Vitest 4, Node.js 24
**Structure:** Monorepo-style single package with `src/server/` (Express API + SQLite) and `src/client/` (React SPA), linked via Vite dev proxy
**Lines of Code:** ~4,800 TypeScript (24 files), ~11,800 total including config/docs
**Purpose:** A single-user, local web application that parses Claude Code JSONL session files from `~/.claude/projects/`, stores token usage data in SQLite, and presents a dashboard with cost estimation, cache efficiency metrics, session history, billing cycle comparison, and data export. Designed for personal use on a single machine to answer "how much am I spending on Claude Code?"

## Current Baseline

| Metric | Value | Notes |
|--------|-------|-------|
| TypeScript source files | 24 | 14 server, 10 client |
| Lines of TypeScript | ~4,800 | Via cloc |
| API endpoints | 17 | 14 in route files + 3 in index.ts (health, shutdown, static) |
| DB tables | 7 | sessions, subagents, usage_records, exchanges, daily_stats, sync_state, settings |
| React components | 8 | Dashboard + 7 sub-components |
| Runtime dependencies | 3 | better-sqlite3, express, react-icons |
| Dev dependencies | 10 | Types, React, Vite, tsx, vitest, concurrently |
| Lock file packages | 283 | From package-lock.json |
| node_modules size | 205 MB | |
| Test files | 2 | jsonl.test.ts, queries.test.ts |
| Test count | 66 | All passing (69ms total runtime) |
| Database size (active) | 6 MB | data/usage.db |
| Test suite duration | ~217ms | Very fast, in-memory SQLite |

## Codebase Profile

### Features & Capabilities

The application provides:

- **Session parsing** -- Reads Claude Code JSONL files from `~/.claude/projects/`, including recursive subagent file discovery (`src/server/parser/jsonl.ts`). Handles streaming message deduplication (same message ID appears multiple times with increasing token counts; last occurrence wins).

- **Incremental sync** -- Tracks file offsets per session file via `sync_state` table (`src/server/db/queries.ts:228-245`). On re-sync, only reads new bytes appended since last sync. Falls back to full re-parse with record clearing on explicit "Sync All."

- **Automatic sync** -- Shell script hook (`scripts/sync-on-exit.sh`) integrates with Claude Code's `SessionEnd` hook. Starts the Express server if not running, syncs the session, shuts down the server if it started it. Robust with jq/grep fallback for JSON parsing.

- **Token tracking** -- Records input tokens, output tokens, cache write tokens, and cache read tokens per API call. Aggregates at session, daily, and summary levels. Subagent tokens are attributed to the parent session.

- **Model-aware cost estimation** -- SQL-embedded pricing for 5 model tiers: Sonnet 4, Sonnet 4.5 (standard), Sonnet 4.5 (high-context >200K), Opus 4.5, Haiku 4.5. Cache writes at 125% of base input, cache reads at 10%. Includes "cost without caching" for savings calculation (`src/server/db/queries.ts:12-47`).

- **Exchange/turn tracking** -- Parses user-assistant conversation turns with duration calculation. Uses a gap threshold (30 minutes) to split sessions into active engagement blocks, filtering out idle time (`src/server/db/queries.ts:3`, `src/server/db/queries.ts:282-303`).

- **Dashboard UI** -- Collapsible accordion sections for Aggregated Stats, Subscription Comparison, Filters, Daily Usage, and Sessions (`src/client/components/Dashboard.tsx`).

- **Subscription comparison** -- Monthly cost breakdown comparing API spend against Pro ($20/mo), Max 5x ($100/mo), and Max 20x ($200/mo) plans, with per-month and cumulative savings/overpayment calculations (`src/client/components/SubscriptionComparison.tsx`).

- **Billing cycle navigation** -- Configurable subscription start date stored in DB settings. Navigate between billing periods (previous/next/current). Select 1-12 cycle ranges. Automatically constrains navigation to not exceed subscription start date (`src/client/components/BillingCycleDropdown.tsx`).

- **Filtering** -- By date range (manual or quick-select 7/30/90 days), project, and custom session title. All three filters compose and apply to all views simultaneously.

- **Inline editing** -- Session custom titles and project names are editable directly in the session table via click-to-edit fields (`src/client/components/SessionList.tsx:330-362`).

- **Session management** -- Delete sessions (cascade removes usage_records, exchanges, subagents). Copy session external IDs to clipboard.

- **Data export** -- Download daily stats or session data as CSV or JSON, respecting current filter state (`src/client/components/Dashboard.tsx:187-208`).

- **Pagination** -- Configurable page sizes (25/50/75/100) for both session list and daily stats table.

- **Settings persistence** -- Key-value settings table storing subscription start date. API for get/put (`src/server/routes/settings.ts`).

Notable:
- The `daily_stats` table is created in the schema (`src/server/db/schema.ts:87-96`) but is never populated or queried -- daily stats are computed on-the-fly from `usage_records` via `getDailyStats()`. This is a vestigial table from the original implementation plan's "materialized for performance" design that was superseded by direct aggregation queries.
- No client-side routing or multi-page support -- the entire UI is a single Dashboard component. Extension to multiple pages would require adding a router.

### Architecture & Patterns

**Organization:** Clean separation between server (`src/server/`) and client (`src/client/`). Server has three layers: routes (HTTP handling), parser (JSONL file processing), and db (schema + queries). Client is a flat component tree under `Dashboard`.

**Server architecture:**
- Entry point: `src/server/index.ts` -- Express app with JSON middleware, route mounting, static file serving, and graceful shutdown handlers (SIGINT, SIGTERM).
- Database: Singleton pattern via `getDb()` / `setDb()` / `closeDb()` in `schema.ts`. Schema initialization runs on first connection (CREATE TABLE IF NOT EXISTS). Two migrations handled via try/catch ALTER TABLE and DROP TABLE.
- Query layer: `queries.ts` is the largest file (754 lines) containing all SQL queries, cost calculation SQL, type interfaces, and CRUD operations. Cost calculation is done in SQL via CASE expressions embedded as template strings (`MESSAGE_COST_SQL`, `MESSAGE_COST_NO_CACHE_SQL`).
- Parser: `jsonl.ts` reads entire files into memory with `readFileSync`, splits by newline, and processes line by line. Deduplicates streaming messages via Map keyed by message ID.
- Routes: Thin handlers that delegate to parser or query functions. Consistent try/catch with error logging and 500 responses.

**Client architecture:**
- Single-page React app. `Dashboard` is the orchestrator component managing all state (filters, sync status, accordion open/close, export) and passing it down via props.
- No state management library. All state in `useState` hooks at Dashboard level, with `useEffect` for data fetching and `useCallback` for memoized fetch functions.
- Styling via inline `React.CSSProperties` objects -- no CSS files, no CSS-in-JS library, no utility classes. Each component defines its own `styles` record.
- No shared component library or design tokens.

**Data flow:**
1. JSONL files -> `parseSessionFile()` -> upsert into sessions/subagents/usage_records/exchanges tables
2. API request -> route handler -> query function -> SQLite -> JSON response
3. React component -> `fetch()` -> `setState()` -> re-render

**Key design decisions:**
- Synchronous SQLite (better-sqlite3) -- correct choice for single-user local app; avoids async complexity and is faster than async drivers for this use case.
- SQL-embedded cost calculation -- pricing logic lives in SQL CASE expressions rather than application code. Enables consistent cost calculation at the query level but makes pricing updates require modifying two large SQL template strings in lockstep.
- Full file reads rather than streaming -- `readFileSync` loads entire JSONL files into memory. Acceptable for session files (typically KB to low MB) but could be a bottleneck for extremely large sessions.
- ES Modules throughout -- `"type": "module"` in package.json, `.js` extensions in imports even for `.ts` files (TypeScript ESM convention).

**Concerns:**

- **[MEDIUM]** `src/server/db/queries.ts` at 754 lines handles interfaces, CRUD, aggregation queries, cost SQL, settings CRUD, and cleanup logic -- it is the single largest file and could benefit from separation as the project grows. Currently manageable but approaching the point where finding/modifying a specific query requires significant scrolling.

- **[MEDIUM]** Cost calculation SQL (`MESSAGE_COST_SQL` and `MESSAGE_COST_NO_CACHE_SQL`, `src/server/db/queries.ts:12-47`) duplicates the pricing logic in two parallel CASE expressions that must be kept in sync. A change to pricing requires updating both strings identically except for the cache rate difference -- error-prone if a new model tier is added.

### Code Quality & Patterns

**TypeScript usage:** Strict mode enabled in both tsconfigs. Explicit interfaces for all data structures (`Session`, `UsageRecord`, `Exchange`, `SessionStats`, `DailyStats`, `Summary`, `SubagentStats`, `MonthlyCost`). No `any` casts found in source code. Type assertions on DB query results use `as` casts (standard pattern for better-sqlite3 which returns `unknown`).

**Consistency:** Code style is consistent across the codebase. All server route handlers follow the same try/catch pattern. All client components follow the same inline-styles-object pattern. No linter or formatter config present (no `.eslintrc`, no `.prettierrc`), but the code is consistently formatted -- likely maintained by hand or editor config.

**Error handling:** Server routes wrap all logic in try/catch, log to console.error, and return 500 with error message. Parser silently skips invalid JSON lines (appropriate for JSONL robustness). Client components catch fetch errors and either log to console or show error state in UI.

**Concerns:**

- **[LOW]** `formatNumber` and `formatCurrency` utility functions are duplicated across 4 client components (`AggregatedStatsCard.tsx:62`, `DailyStatsTable.tsx:101`, `SessionList.tsx:229`, `SubscriptionComparison.tsx:116`). Each is a small 3-5 line function, but they diverge slightly -- `DailyStatsTable.formatNumber` uses `toLocaleString()` while the others add K/M suffixes.

- **[LOW]** The `Summary` interface is duplicated between `Dashboard.tsx:11` and `AggregatedStatsCard.tsx:5`. The Dashboard version omits `claudeActiveHours` which `AggregatedStatsCard` needs, so they have slightly diverged.

### Dependencies & Stack

**Runtime dependencies (3):**
| Package | Version | Purpose |
|---------|---------|---------|
| better-sqlite3 | ^12.6.2 | SQLite database driver (synchronous, native) |
| express | ^5.2.1 | HTTP server framework (Express 5 -- latest major) |
| react-icons | ^5.5.0 | Icon library (only `CgMathPlus` and `CgMathEqual` used in AggregatedStatsCard) |

**Dev dependencies (10):**
| Package | Version | Purpose |
|---------|---------|---------|
| @types/better-sqlite3 | ^7.6.13 | Types |
| @types/express | ^5.0.6 | Types |
| @types/node | ^25.2.2 | Types |
| @types/react | ^19.2.13 | Types |
| @types/react-dom | ^19.2.3 | Types |
| @vitejs/plugin-react | ^5.1.3 | Vite React plugin |
| concurrently | ^9.2.1 | Run server + client in parallel for dev |
| react, react-dom | ^19.2.4 | UI library (in devDependencies, not runtime -- likely a packaging choice since Vite bundles them) |
| tsx | ^4.21.0 | TypeScript execution for server |
| typescript | ^5.9.3 | TypeScript compiler |
| vite | ^7.3.1 | Build tool and dev server |
| vitest | ^4.0.18 | Test framework |

**Dependency minimalism:** The runtime dependency count (3) is exceptionally low. React and react-dom are in devDependencies because Vite bundles them into the client build.

**Audit status:** `npm audit` reports 3 vulnerabilities:
- **picomatch** 4.0.0-4.0.3 (high) -- ReDoS and method injection. Transitive dependency via Vite/rollup.
- **rollup** 4.0.0-4.58.0 (high) -- Arbitrary file write via path traversal. Build tool dependency.
- **qs** 6.7.0-6.14.1 (low) -- arrayLimit bypass DoS. Transitive via Express.

All are fixable via `npm audit fix`.

**Concerns:**

- **[MEDIUM]** 3 known vulnerabilities in transitive dependencies (2 high, 1 low) -- all fixable via `npm audit fix` (`picomatch` via vite, `rollup` directly, `qs` via express). The high-severity ones affect the build tool chain (rollup/picomatch) rather than runtime, reducing actual risk for this local-only application. The `qs` vulnerability is runtime-facing via Express but low severity.

### Testing & Validation

**Framework:** Vitest 4 with Node.js environment. Config at `vitest.config.ts` scopes tests to `src/server/**/*.test.ts` only.

**Test infrastructure:** In-memory SQLite via `setupTestDb()` / `teardownTestDb()` helpers (`src/server/test/setup.ts`). The `setDb()` function in `schema.ts` was added specifically to enable dependency injection for testing -- elegant minimal change (4 lines) to the production code. Fixture data in `src/server/test/fixtures.ts` provides 8 named JSONL constants covering various scenarios (basic, streaming dedup, custom titles, skippable lines, invalid JSON, model tiers, subagents, multi-turn).

**Coverage:**
- `src/server/parser/jsonl.test.ts`: 30 tests covering pure function unit tests (4 tests for path extraction functions) and integration tests for the full parse-to-DB pipeline (session parsing, streaming dedup, skip/invalid lines, custom titles, sync state, incremental sync, idempotent upsert, exchange tracking with duration verification, subagent linking).
- `src/server/db/queries.test.ts`: 36 tests covering CRUD operations, all 5 pricing tiers with hand-calculated expected values, aggregation queries with filters, duration/gap-threshold calculations, cache savings computation, and cleanup operations.
- All 66 tests pass in ~217ms (69ms test execution, rest is transform/import overhead).

**What is NOT tested:**
- No client-side tests. No React component tests, no integration tests for the frontend.
- No API route-level tests (e.g., supertest against Express). Route handlers are thin wrappers, so the risk is lower, but request validation logic (like the date format regex in settings.ts:29) is untested.
- No end-to-end tests.
- `syncAllSessions()` and `findAllSessionFiles()` are not directly tested (they depend on filesystem traversal of `~/.claude/`).
- The sync shell script (`scripts/sync-on-exit.sh`) has no automated tests.

**Concerns:**

- **[MEDIUM]** No frontend tests exist. The client has 8 components with non-trivial logic: billing cycle date math (`BillingCycleDropdown.tsx:8-51`), CSV generation (`Dashboard.tsx:171-185`), pagination, inline editing with save/cancel. These are tested only manually.

### Security Posture

**Auth:** None. This is a single-user local application bound to `localhost:3000`. No authentication, no session management, no API keys.

**Secrets:** No hardcoded secrets found. The only configuration is the server port via `PORT` environment variable with a default of 3000. The database path is derived from `__dirname` relative to the source file.

**Input validation:** Minimal. Route handlers use TypeScript type assertions on `req.body` and `req.query` without runtime validation. The settings route validates date format via regex (`/^\d{4}-\d{2}-\d{2}$/`). Session IDs from URL params are parsed with `parseInt` and checked for NaN.

**SQL injection:** Not a concern -- all database access uses parameterized queries via better-sqlite3's `prepare()` and parameter binding.

**Network exposure:** Server listens on all interfaces by default (`app.listen(PORT)` without specifying a host). For a local-only tool, this means the API is accessible from the local network, not just localhost.

**Shutdown endpoint:** `POST /api/shutdown` (`src/server/index.ts:31-37`) has no authentication and calls `process.exit(0)`. Anyone on the local network could shut down the server.

**Concerns:**

- **[MEDIUM]** `POST /api/shutdown` at `src/server/index.ts:31-37` has no authentication. Combined with the server listening on all interfaces (no `host: 'localhost'` in `app.listen()`), any device on the local network can shut down the server via `curl -X POST http://<machine-ip>:3000/api/shutdown`. For a personal tool this is low-impact but could be disruptive if the machine is on a shared network.

### Performance

**Database:** WAL mode enabled (`schema.ts:13`), which is the correct choice for concurrent read/write on SQLite. Indexes exist on all foreign keys and common query columns (session_id, timestamp, external_id, project, start_time). The `getSessionStats` query includes a correlated subquery with window functions for duration calculation -- this is the heaviest query in the system.

**Parser:** Reads entire JSONL files into memory via `readFileSync` (`src/server/parser/jsonl.ts:132`). For typical Claude Code session files (single-digit MB), this is fine. Incremental sync via file offsets reduces re-parsing, but the offset tracking reads the entire file and then processes from the beginning -- the `startOffset` variable is set but not used to skip bytes during read.

**Sync all:** `syncAllSessions()` processes all session files sequentially. For a large number of sessions (hundreds), this could take noticeable time. Each file is parsed and inserted individually rather than batched.

**Frontend:** No virtualization on the session list or daily stats table. All data is fetched and stored in state; pagination is client-side (slicing the full array). With many sessions, the initial fetch loads all data into the browser.

**Concerns:**

- **[MEDIUM]** The incremental sync reads the entire file content regardless of offset (`src/server/parser/jsonl.ts:132`), despite tracking `startOffset`. Lines are parsed from the beginning even when only new data is needed. For large session files being re-synced, this means re-reading and re-parsing content that was already processed. The offset tracking correctly prevents duplicate DB inserts (via upsert), but the file I/O and JSON parsing are repeated.

- **[LOW]** `getSessionStats` fetches all matching sessions with no server-side pagination (`src/server/db/queries.ts:265-333`). With hundreds or thousands of sessions, this could result in a large JSON response. Pagination is done client-side after receiving the full dataset.

### Developer Experience

**Setup:** `npm install` and `npm run dev` starts both the Express server (via tsx watch) and Vite dev server with HMR and API proxy. The `.nvmrc` specifies Node 24.13.0.

**Scripts:**
| Command | What it does |
|---------|-------------|
| `npm run dev` | Concurrently runs server (tsx watch) + client (vite) |
| `npm run server` | Server only with auto-restart on changes |
| `npm run client` | Vite dev server only |
| `npm run build` | `vite build && tsc -p tsconfig.server.json` |
| `npm start` | Runs production build from `dist/` |
| `npm test` | `vitest run` (single pass) |
| `npm run test:watch` | `vitest` (watch mode) |

**Documentation:** Thorough README with feature list, API endpoint table, cost calculation breakdown, project structure, and setup instructions. `IMPLEMENTATION_PLAN.md` and `PROJECT_NOTES.md` document the original design decisions and Claude Code data format. `claude-plans/` contains 6 plan files for incremental features.

**DX pain points:** No linter or formatter configured. The `dist/` directory is checked into git (it exists in the repo but is gitignored -- the directory shell exists but actual build outputs would be generated fresh). The untracked `sessions-2026-03-18.json` file (38KB) at the repo root appears to be a data export that was not cleaned up.

**Concerns:**

- **[LOW]** No linter or formatter is configured (no eslint, prettier, or biome config). Code style is currently consistent but relies on manual discipline. This becomes a concern as the project grows or accepts contributions.

- **[LOW]** An untracked 38KB data file (`sessions-2026-03-18.json`) sits at the repo root. It contains session data with filesystem paths. It appears to be a one-off export and should either be gitignored or removed.

### Observability

**Logging:** Console logging throughout. `console.log` for server startup, `console.error` for route handler errors and parser errors, `console.warn` for format change detection (when usage records exist but no exchanges are found, `src/server/parser/jsonl.ts:354-358`).

**Health check:** `GET /api/health` returns `{ status: "ok", timestamp: "..." }` (`src/server/index.ts:26-28`).

**Server log:** The sync script redirects server output to `data/server.log` when starting the server in the background.

**No structured logging, no metrics collection, no error tracking.** Appropriate for the scope of a personal local tool.

No concerns found in this dimension.

## Concerns

### Critical
(none)

### High
(none)

### Medium
- **C-01** [HIGH]: 3 known vulnerabilities in transitive dependencies (2 high in picomatch/rollup, 1 low in qs); all fixable via `npm audit fix` (Dependencies)
- **C-02** [HIGH]: `POST /api/shutdown` at `src/server/index.ts:31-37` has no auth; combined with server listening on all interfaces, any LAN device can shut down the server (Security)
- **C-03** [HIGH]: Incremental sync reads the entire file (`src/server/parser/jsonl.ts:132`) despite tracking byte offsets -- re-reads and re-parses already-processed content on every sync (Performance)
- **C-04** [MEDIUM]: `src/server/db/queries.ts` at 754 lines handles all query logic, interfaces, cost SQL, settings, and cleanup in a single file (Architecture)
- **C-05** [MEDIUM]: Cost SQL logic duplicated in two parallel CASE expressions (`MESSAGE_COST_SQL` and `MESSAGE_COST_NO_CACHE_SQL`, `src/server/db/queries.ts:12-47`) that must be updated in lockstep (Architecture)
- **C-06** [MEDIUM]: No frontend tests for 8 components with non-trivial logic including billing cycle date math, CSV generation, and inline editing (Testing)

### Low
- **C-07** [HIGH]: `formatNumber` and `formatCurrency` duplicated across 4 client components with slight divergence in behavior (`AggregatedStatsCard.tsx:62`, `DailyStatsTable.tsx:101`, `SessionList.tsx:229`, `SubscriptionComparison.tsx:116`) (Code Quality)
- **C-08** [HIGH]: `Summary` interface duplicated between `Dashboard.tsx:11` and `AggregatedStatsCard.tsx:5` with field divergence (Code Quality)
- **C-09** [MEDIUM]: `daily_stats` table created in schema (`src/server/db/schema.ts:87-96`) but never populated or queried -- vestigial from original plan (Architecture)
- **C-10** [LOW]: `getSessionStats` returns full dataset with no server-side pagination (`src/server/db/queries.ts:265-333`) (Performance)
- **C-11** [LOW]: No linter or formatter configured -- code consistency relies on manual discipline (DX)
- **C-12** [LOW]: Untracked 38KB data export file (`sessions-2026-03-18.json`) at repo root containing session data with filesystem paths (DX)

## Confidence Notes

- **C-03** (MEDIUM confidence): Confirmed that `readFileSync` at line 132 always reads the full file. The `startOffset` is used to check `if (startOffset >= stats.size)` for early return, and for `updateSyncState`, but is not used to seek into the file or skip lines during parsing. Would need profiling to confirm this is a real bottleneck for typical session sizes, but the code path is clear.
- **C-10** (LOW confidence): Identified from code that no LIMIT/OFFSET is applied to the sessions query. Whether this causes a real performance issue depends on the number of sessions in the database. With 6MB DB, it is likely hundreds to low thousands of sessions, where this may not matter yet.

## Opportunities

| ID | Opportunity | Type | Priority | Source |
|----|------------|------|----------|--------|
| DEP-01 | Run `npm audit fix` to resolve 3 known dependency vulnerabilities | Fix | Medium | C-01 |
| SEC-01 | Bind Express server to `localhost` only and/or add basic auth to shutdown endpoint | Fix | Medium | C-02 |
| PERF-01 | Use file offset to skip already-parsed bytes when reading JSONL (seek or readline from offset) | Fix | Medium | C-03 |
| ARCH-01 | Split `queries.ts` into focused modules (session-queries, stats-queries, settings-queries, cost-sql) | Improvement | Medium | C-04 |
| ARCH-02 | Extract cost pricing into a single data structure and generate both SQL variants programmatically | Improvement | Medium | C-05 |
| TEST-01 | Add frontend component tests (at minimum for BillingCycleDropdown date math and CSV generation) | Improvement | Medium | C-06 |
| IMP-01 | Extract shared utility functions (formatNumber, formatCurrency, etc.) into a client `utils/` module | Improvement | Low | C-07 |
| IMP-02 | Define shared TypeScript interfaces (Summary, Session, etc.) in a common types file | Improvement | Low | C-08 |
| ARCH-03 | Remove unused `daily_stats` table from schema or implement materialized stats as originally planned | Improvement | Low | C-09 |
| PERF-02 | Add server-side pagination to session and daily stats endpoints (LIMIT/OFFSET) | Improvement | Low | C-10 |
| DX-01 | Add ESLint or Biome configuration for consistent code formatting and lint rules | Improvement | Low | C-11 |
| DX-02 | Remove or gitignore the stale `sessions-2026-03-18.json` export file | Fix | Low | C-12 |
| FEAT-01 | Add charts/visualizations for token usage trends over time (the README UI section notes "Much to be improved!") | Feature | Medium | Profile: Features |
| FEAT-02 | Add support for new Anthropic models as they are released (pricing table update mechanism) | Feature | Medium | Profile: Features |
| FEAT-03 | Add client-side routing for multi-page navigation (e.g., separate session detail view, settings page) | Feature | Low | Profile: Architecture |
| FEAT-04 | Add per-session message/exchange detail view (the exchanges table stores user_content but it is not displayed) | Feature | Low | Profile: Features |
| UPG-01 | Add CSS/styling solution (CSS Modules, Tailwind, or vanilla CSS files) to replace inline style objects | Upgrade | Low | Profile: Code Quality |

**Total: 17 opportunities (7 Medium, 10 Low)**
