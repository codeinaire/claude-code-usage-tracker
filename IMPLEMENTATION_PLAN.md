# Claude Code Usage Tracker - Implementation Plan

## Overview

A web-based application that tracks Claude Code usage by parsing JSONL session files and storing data in SQLite (better-sqlite3). Syncs automatically via Claude Code's SessionEnd hook.

---

## Project Structure

```
claude-code-usage-tracker/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── server/
│   │   ├── index.ts              # Express server entry point
│   │   ├── db/
│   │   │   ├── schema.ts         # SQLite schema + migrations
│   │   │   └── queries.ts        # Database query functions
│   │   ├── parser/
│   │   │   └── jsonl.ts          # JSONL parsing for Claude Code format
│   │   └── routes/
│   │       ├── sync.ts           # POST /api/sync endpoints
│   │       └── stats.ts          # GET /api/stats endpoints
│   └── client/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       └── components/
│           ├── Dashboard.tsx     # Main dashboard with aggregated stats
│           ├── SessionList.tsx   # List of sessions with totals
│           ├── DailyStatsTable.tsx  # Simple table for daily stats
│           └── DateRangePicker.tsx
├── scripts/
│   └── sync-on-exit.sh           # Hook script (start server, sync, shutdown)
└── data/
    └── usage.db                  # SQLite database (gitignored)
```

---

## Implementation Steps

### Step 1: Project Setup
- Initialize package.json with dependencies:
  - `better-sqlite3` - SQLite driver
  - `express` - API server
  - `tsx` - TypeScript execution
  - `react`, `react-dom` - UI
  - `vite` - Build tool & dev server
  - `@vitejs/plugin-react` - React plugin for Vite
- Configure TypeScript (tsconfig.json)
- Configure Vite for React + API proxy

### Step 2: Database Layer
- Create SQLite schema (sessions, subagents, messages, daily_stats tables)
- Initialize database on first run
- Implement query functions:
  - `upsertSession()`
  - `upsertSubagent()`
  - `insertMessages()`
  - `getSessionStats(dateRange)`
  - `getDailyStats(dateRange)`
  - `getProjectStats(dateRange)`

### Step 3: JSONL Parser
- Parse Claude Code JSONL format
- Extract from each line:
  - sessionId, timestamp, model, version
  - usage object (input_tokens, output_tokens, cache tokens)
- Handle both main session files and subagent files
- Track file offsets for incremental parsing (optional optimization)

### Step 4: API Endpoints
- `POST /api/sync` - Sync a specific session (receives transcript_path)
- `POST /api/sync/all` - Full import of all sessions in ~/.claude/projects/
- `GET /api/stats/sessions` - List sessions with aggregated totals
- `GET /api/stats/daily` - Daily aggregated stats
- `GET /api/stats/summary` - Overall summary (total tokens, cost, etc.)
- `POST /api/shutdown` - Graceful server shutdown

### Step 5: React UI
- Dashboard page showing:
  - Summary cards (total tokens, estimated cost, session count)
  - Date range picker for filtering
  - Daily usage table (date, input tokens, output tokens, cost)
  - Session list with per-session totals
- Manual "Sync All" button for initial import
- Clean, minimal design (no charting library - just tables)
- Server runs on port 3000

### Step 6: Sync Script
Create `scripts/sync-on-exit.sh`:
1. Read session data from stdin (hook input)
2. Extract transcript_path using jq
3. Check if server is running (curl health check)
4. If not running, start server in background, wait for ready
5. POST to /api/sync with transcript_path
6. POST to /api/shutdown
7. Exit cleanly

### Step 7: Hook Configuration
Add to `~/.claude/settings.json`:
```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-code-usage-tracker/scripts/sync-on-exit.sh"
          }
        ]
      }
    ]
  }
}
```

---

## API Specification

### POST /api/sync
Sync a single session.
```json
Request: { "transcriptPath": "/path/to/session.jsonl" }
Response: { "success": true, "messagesImported": 42 }
```

### POST /api/sync/all
Import all sessions from ~/.claude/projects/.
```json
Response: { "success": true, "sessionsImported": 15, "messagesImported": 1234 }
```

### GET /api/stats/sessions?from=DATE&to=DATE
```json
Response: {
  "sessions": [
    {
      "id": "abc123",
      "project": "my-project",
      "startTime": "2026-02-01T10:00:00Z",
      "endTime": "2026-02-01T11:30:00Z",
      "totalInputTokens": 45000,
      "totalOutputTokens": 12000,
      "estimatedCostUsd": 0.85,
      "messageCount": 34
    }
  ]
}
```

### GET /api/stats/daily?from=DATE&to=DATE
```json
Response: {
  "daily": [
    { "date": "2026-02-01", "inputTokens": 100000, "outputTokens": 25000, "costUsd": 2.50 }
  ]
}
```

### GET /api/stats/summary
```json
Response: {
  "totalInputTokens": 1500000,
  "totalOutputTokens": 350000,
  "totalCostUsd": 45.00,
  "sessionCount": 89,
  "firstSession": "2026-01-15",
  "lastSession": "2026-02-02"
}
```

---

## Cost Calculation

```typescript
const PRICING = {
  'claude-opus-4-5-20251101': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] || PRICING['claude-sonnet-4-20250514'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
```

---

## Configuration

- **Server port**: 3000
- **Vite dev port**: 5173 (proxies API to 3000)
- **Database path**: ./data/usage.db

## Verification

1. **Database**: Run `npm run dev`, check that `data/usage.db` is created with correct schema
2. **Parser**: Manually test parsing a JSONL file from ~/.claude/projects/
3. **API**: Use curl to test endpoints:
   - `curl -X POST http://localhost:3000/api/sync/all`
   - `curl http://localhost:3000/api/stats/summary`
4. **UI**: Open http://localhost:5173, verify dashboard loads and displays data
5. **Hook**: End a Claude Code session, verify data syncs automatically

---

## Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

---

## Implementation Order

1. Project setup (package.json, tsconfig, vite config)
2. Database schema + initialization
3. JSONL parser
4. Express server + sync endpoints
5. Stats query endpoints
6. React UI components
7. Sync script + hook configuration
