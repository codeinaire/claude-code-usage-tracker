# Claude Code Usage Tracker

A web-based application that tracks your Claude Code usage by parsing JSONL session files and storing data in SQLite. View your token usage, estimated costs, cache efficiency, and session history through a clean dashboard.

## Features

- **Session Parsing** - Parses Claude Code session files from `~/.claude/projects/`, including subagent data
- **Token Tracking** - Tracks input/output tokens, cache writes, and cache reads per session and subagent
- **Cost Estimation** - Model-aware cost calculations with cache discount breakdowns and "money saved" metrics
- **Dashboard** - Collapsible sections with aggregated stats cards, session list, and daily usage table
- **Filtering** - Filter by date range (with quick-select presets), project, or custom session title
- **Custom Titles** - Name your sessions with inline-editable custom titles
- **Subagent Tracking** - Expandable per-session subagent breakdown showing token usage per child agent
- **Data Export** - Export daily stats or session data as CSV or JSON
- **Pagination** - Configurable page sizes (25/50/75/100) for session and daily stats tables
- **Automatic Sync** - Hook into Claude Code's SessionEnd event to auto-import sessions
- **Incremental Sync** - Only parses new data since last sync using file offset tracking

## Quick Start

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Open http://localhost:5173/ in your browser
# Click "Sync All Sessions" to import your usage data
```

## Usage

### Manual Sync

1. Run `npm run dev` to start both the API server and Vite dev server
2. Open http://localhost:5173/
3. Click "Sync All Sessions" to import all your Claude Code session data

### Automatic Sync (Recommended)

Set up a hook to automatically sync after each Claude Code session ends.

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "<path to claude code usage tracker>/scripts/sync-on-exit.sh"
          }
        ]
      }
    ]
  }
}
```

Replace `<path to claude code usage tracker>` with the actual path to this project.

The sync script will:

1. Read session data from stdin
2. Start the server if not already running
3. Sync the session transcript to the database
4. Shut down the server if it was started by the script

## API Endpoints

### Sync

| Endpoint       | Method | Description                                           |
| -------------- | ------ | ----------------------------------------------------- |
| `/api/sync`    | POST   | Sync a single session (`{ "transcriptPath": "..." }`) |
| `/api/sync/all`| POST   | Import all sessions from `~/.claude/projects/`        |

### Stats

| Endpoint                              | Method | Description                                                     |
| ------------------------------------- | ------ | --------------------------------------------------------------- |
| `/api/stats/summary`                  | GET    | Overall usage summary. Supports `?project=` and `?customTitle=` |
| `/api/stats/daily`                    | GET    | Daily aggregated stats. Supports `?from=&to=&project=&customTitle=` |
| `/api/stats/sessions`                 | GET    | Per-session stats. Supports `?from=&to=&project=&customTitle=`  |
| `/api/stats/sessions/:id/subagents`   | GET    | Subagent stats for a specific session                           |
| `/api/stats/sessions/:id/custom-title`| PATCH  | Update a session's custom title (`{ "customTitle": "..." }`)    |
| `/api/stats/projects`                 | GET    | List all distinct project paths                                 |
| `/api/stats/custom-titles`            | GET    | List all distinct custom session titles                         |

### System

| Endpoint        | Method | Description                  |
| --------------- | ------ | ---------------------------- |
| `/api/health`   | GET    | Health check                 |
| `/api/shutdown` | POST   | Gracefully shutdown server   |

## Cost Calculation

Costs are estimated based on current Anthropic pricing:

| Model                          | Input (per 1M) | Cache Write (per 1M) | Cache Read (per 1M) | Output (per 1M) |
| ------------------------------ | -------------- | -------------------- | ------------------- | ---------------- |
| Claude Sonnet 4.5 (>200K ctx)  | $6.00          | $7.50                | $0.60               | $22.50           |
| Claude Sonnet 4.5 (<=200K ctx) | $3.00          | $3.75                | $0.30               | $15.00           |
| Claude Opus 4.5                | $5.00          | $6.25                | $0.50               | $25.00           |
| Claude Haiku 4.5               | $1.00          | $1.25                | $0.10               | $5.00            |
| Claude Sonnet 4 (default)      | $3.00          | $3.75                | $0.30               | $15.00           |

Cache write tokens are charged at 125% of the base input price. Cache read tokens are charged at 10% of the base input price.

## Tech Stack

- **Backend**: Express.js, SQLite (better-sqlite3), TypeScript
- **Frontend**: React 19, Vite, TypeScript, react-icons
- **Runtime**: Node.js (ES modules)

## Project Structure

```
claude-code-usage-tracker/
├── src/
│   ├── server/
│   │   ├── index.ts           # Express server entry point
│   │   ├── db/
│   │   │   ├── schema.ts      # SQLite schema & migrations
│   │   │   └── queries.ts     # Database queries & cost calculations
│   │   ├── parser/
│   │   │   └── jsonl.ts       # JSONL session file parser
│   │   └── routes/
│   │       ├── sync.ts        # Sync endpoint handlers
│   │       └── stats.ts       # Stats endpoint handlers
│   └── client/
│       ├── main.tsx           # React entry point
│       ├── App.tsx            # Main app layout
│       └── components/
│           ├── Dashboard.tsx          # Main dashboard with sync/export
│           ├── AggregatedStatsCard.tsx # Summary cards with cache metrics
│           ├── SessionList.tsx        # Paginated session table with subagents
│           ├── DailyStatsTable.tsx    # Daily usage breakdown table
│           ├── DateRangePicker.tsx    # Date range filter with presets
│           ├── ProjectFilter.tsx      # Project dropdown filter
│           └── CustomTitleFilter.tsx   # Custom title dropdown filter
├── scripts/
│   └── sync-on-exit.sh        # Claude Code SessionEnd hook script
├── data/
│   └── usage.db               # SQLite database (gitignored)
├── vite.config.ts
├── tsconfig.json              # Client TypeScript config
└── tsconfig.server.json       # Server TypeScript config
```

## Scripts

| Command          | Description                              |
| ---------------- | ---------------------------------------- |
| `npm run dev`    | Start both server and Vite dev server    |
| `npm run server` | Start only the API server                |
| `npm run client` | Start only the Vite dev server           |
| `npm run build`  | Build client and compile server for prod |
| `npm start`      | Run the production build                 |

## Requirements

- Node.js 18+
- npm
- jq (optional, for the sync script - falls back to grep/sed)

## TODO

- Add unit tests to check validity of numbers
- Refactor
