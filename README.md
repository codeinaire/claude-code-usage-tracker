# Claude Code Usage Tracker

A web-based application that tracks your Claude Code usage by parsing JSONL session files and storing data in SQLite. View your token usage, estimated costs, and session history through a clean dashboard.

## Features

- Parses Claude Code session files from `~/.claude/projects/`
- Tracks input/output tokens and cache usage
- Calculates estimated costs based on model pricing
- Daily and per-session usage breakdowns
- Date range filtering
- Automatic sync via Claude Code's SessionEnd hook

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
            "command": "/path/to/claude-code-usage-tracker/scripts/sync-on-exit.sh"
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/claude-code-usage-tracker` with the actual path to this project.

The sync script will:

1. Start the server if not running
2. Sync the session that just ended
3. Shut down the server

## API Endpoints

| Endpoint              | Method | Description                                            |
| --------------------- | ------ | ------------------------------------------------------ |
| `/api/health`         | GET    | Health check                                           |
| `/api/sync`           | POST   | Sync a single session (`{ "transcriptPath": "..." }`)  |
| `/api/sync/all`       | POST   | Import all sessions from ~/.claude/projects/           |
| `/api/stats/summary`  | GET    | Overall usage summary                                  |
| `/api/stats/daily`    | GET    | Daily aggregated stats (supports `?from=DATE&to=DATE`) |
| `/api/stats/sessions` | GET    | Per-session stats (supports `?from=DATE&to=DATE`)      |
| `/api/shutdown`       | POST   | Gracefully shutdown the server                         |

## Cost Calculation

Costs are estimated based on current Anthropic pricing:

| Model            | Input (per 1M tokens) | Cached Write (per 1M tokens) | Cached Read (per 1M tokens) | Output (per 1M tokens) |
| ---------------- | --------------------- | ---------------------------- | --------------------------- | ---------------------- |
| Claude Opus 4.5  | $5.00                 | $6.25                        | $0.50                       | $25.00                 |
| Claude Sonnet 4  | $3.00                 | $3.75                        | $0.30                       | $15.00                 |
| Claude Haiku 4.5 | $1.00                 | $1.25                        | $0.10                       | $5.00                  |

## Project Structure

```
claude-code-usage-tracker/
├── src/
│   ├── server/           # Express API server
│   │   ├── index.ts      # Server entry point
│   │   ├── db/           # SQLite schema and queries
│   │   ├── parser/       # JSONL file parser
│   │   └── routes/       # API route handlers
│   └── client/           # React frontend
│       ├── App.tsx
│       └── components/   # Dashboard, tables, etc.
├── scripts/
│   └── sync-on-exit.sh   # Hook script for automatic sync
└── data/
    └── usage.db          # SQLite database (gitignored)
```

## Scripts

- `npm run dev` - Start both server and Vite dev server
- `npm run server` - Start only the API server
- `npm run client` - Start only the Vite dev server
- `npm run build` - Build for production

## Requirements

- Node.js 18+
- npm
- jq (optional, for the sync script - falls back to grep/sed)
