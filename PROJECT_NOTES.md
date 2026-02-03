# Claude Code Usage Tracker - Project Notes

## Overview

A web-based application that tracks Claude Code usage data by parsing local JSONL files and storing them in a SQLite database (using better-sqlite3).

---

## Claude Code Data Structure

### Directory Layout (`~/.claude/`)

| Directory/File | Size | Purpose |
|----------------|------|---------|
| `cache/` | 80 KB | Cached data including changelog |
| `debug/` | 88 KB | Debug logs with session-specific UUIDs |
| `history.jsonl` | 1.0 KB | Root-level command history (JSONL) |
| `projects/` | 76 KB | Project-specific session data |
| `session-env/` | 96 B | Session environment variables |
| `shell-snapshots/` | 256 KB | Shell environment snapshots for IDE integration |
| `statsig/` | 36 KB | Feature flag and configuration cache |
| `todos/` | 4.0 KB | Task list management for agents |
| `plans/` | empty | Future/planned plans storage |
| `ide/` | empty | IDE-specific configuration |
| `plugins/` | 5.1 MB | Plugin marketplace with official plugins |

### Data Formats

- **JSONL (JSON Lines)** - Primary format for session and conversation history
  - Each line is a complete JSON object
  - Used for streaming and efficient append-only storage
  - Files: `history.jsonl`, project session files, subagent files

- **JSON** - Configuration files
  - Files: `sessions-index.json`, `known_marketplaces.json`, plugin configs, tasks

- **Text/UTF-8** - Debug logs and shell snapshots

### Primary Data Files for Usage Tracking

```
~/.claude/history.jsonl                                    # Quick command history
~/.claude/projects/[project-name]/[sessionId].jsonl        # Main conversation logs
~/.claude/projects/[project-name]/[sessionId]/subagents/agent-*.jsonl  # Subagent interactions
~/.claude/debug/latest                                     # Symlink to most recent debug log
~/.claude/todos/[sessionId]-agent-*.json                   # Task tracking
```

### Token Usage Data Structure

Each assistant message in JSONL includes a `usage` object:

```json
{
  "usage": {
    "input_tokens": 7,
    "output_tokens": 1,
    "cache_creation_input_tokens": 11406,
    "cache_read_input_tokens": 44406,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 0,
      "ephemeral_1h_input_tokens": 11406
    },
    "service_tier": "standard"
  }
}
```

### Session Information Fields

Each message record includes:

| Field | Description | Example |
|-------|-------------|---------|
| `sessionId` | UUID identifying the session | `d6ffec9d-8481-4ad1-b75a-88585f07306f` |
| `timestamp` | ISO 8601 timestamp | `2026-02-02T04:01:52.588Z` |
| `model` | Model used | `claude-opus-4-5-20251101` |
| `message` | Full message content | (object with role, content) |
| `requestId` | Anthropic API request ID | (string) |
| `cwd` | Working directory context | `/Users/.../project` |
| `version` | Claude Code version | `2.1.29` |

### Models Observed

- `claude-opus-4-5-20251101` - Claude Opus 4.5
- `claude-haiku-4-5-20251001` - Claude Haiku 4.5
- (Sonnet likely uses similar naming pattern)

### File Update Behavior

- Files are written atomically (temp file → rename)
- JSONL is append-only - ideal for incremental reads
- Modification timestamps available via filesystem
- Active during sessions; updates on each message

---

## Anthropic Pricing (for cost estimation)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| Opus 4.5 | $15.00 | $75.00 |
| Sonnet 4 | $3.00 | $15.00 |
| Haiku 4 | $0.80 | $4.00 |

*Note: Cache read tokens are typically discounted. Verify current pricing at anthropic.com/pricing*

---

## Architectural Decisions

### Pending Decisions

*(None currently)*

### Confirmed Decisions

1. **Scope** (2026-02-02)
   - Single machine (this machine)
   - Support multiple Claude Code projects
   - No multi-user/multi-machine requirements for now

2. **UI Framework** (2026-02-02)
   - React

3. **UI Features Priority** (2026-02-02)
   - Primary focus: Aggregated data over time periods, per session
   - Features in priority order:
     1. Session-based usage aggregation (tokens, costs per session)
     2. Time-period aggregation (daily/weekly/monthly summaries)
     3. Per-project breakdown
     4. Cost estimates
     5. Dashboard with charts
     6. Export functionality (lower priority)

4. **Sync Strategy** (2026-02-02)
   - Use Claude Code `SessionEnd` hook to trigger sync on exit
   - Hook will start the server if not already running, then sync
   - Server shuts down after sync completes
   - Also support manual sync button in UI for ad-hoc imports
   - "Import All" button for first-time setup / historical import
   - JSONL is append-only so historical data is never lost
   - Sync includes: main session JSONL + all subagent JSONLs for that session

5. **Data Model** (2026-02-02)
   - Subagents stored as separate entity with foreign key to parent session
   - Messages linked to either session (direct) or subagent
   - Allows detailed breakdown queries in future
   - UI shows combined totals (session + all its subagents) for now

---

## Claude Code Hook Configuration

### SessionEnd Hook Setup

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

### Sync Script (`scripts/sync-on-exit.sh`)

The script should:
1. Check if the server is running (e.g., check if port 3000 is listening)
2. Start the server if not running
3. Wait for server to be ready
4. Send sync request with session data from stdin
5. Optionally shut down server after sync (or leave running)

**Hook Input (received on stdin):**
```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../abc123.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

**Exit reasons:**
- `clear` - Session cleared with `/clear`
- `logout` - User logged out
- `prompt_input_exit` - User exited while prompt input was visible
- `bypass_permissions_disabled` - Bypass permissions mode was disabled
- `other` - Other exit reasons

---

## Proposed Architecture

```
~/.claude/projects/*/*.jsonl  →  Watcher/Importer  →  SQLite DB  →  Express API  →  Web UI
                                      │
                                      └── Parses JSONL, extracts usage metrics
```

### Proposed SQLite Schema (Draft)

```sql
-- Sessions table (main conversations)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,           -- sessionId from JSONL
    project TEXT,                  -- derived from directory name
    start_time TEXT,               -- first message timestamp
    end_time TEXT,                 -- last message timestamp
    claude_code_version TEXT,
    transcript_path TEXT           -- path to JSONL file for re-sync
);

-- Subagents table (agents spawned via Task tool)
CREATE TABLE subagents (
    id TEXT PRIMARY KEY,           -- agent ID (e.g., "agent-abc123")
    session_id TEXT NOT NULL,      -- parent session foreign key
    agent_type TEXT,               -- e.g., "Explore", "Bash", "Plan"
    start_time TEXT,
    end_time TEXT,
    transcript_path TEXT,          -- path to subagent JSONL file
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Messages table (raw usage data for both sessions and subagents)
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,               -- parent session
    subagent_id TEXT,              -- NULL if main conversation, set if from subagent
    timestamp TEXT,
    role TEXT,                     -- user/assistant
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_creation_tokens INTEGER,
    cache_read_tokens INTEGER,
    service_tier TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (subagent_id) REFERENCES subagents(id)
);

-- Daily aggregated stats (materialized for performance)
CREATE TABLE daily_stats (
    date TEXT PRIMARY KEY,
    total_input_tokens INTEGER,
    total_output_tokens INTEGER,
    total_cache_creation_tokens INTEGER,
    total_cache_read_tokens INTEGER,
    estimated_cost_usd REAL,
    session_count INTEGER,
    message_count INTEGER
);

-- Indexes for common queries
CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_subagent ON messages(subagent_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_subagents_session ON subagents(session_id);
```

---

## Session Log

### 2026-02-02

- Initial exploration of `~/.claude/` directory structure
- Identified JSONL as primary data format
- Documented token usage structure and available fields
- Outlined architectural options for change detection
- Created this project notes document
- Confirmed React for UI framework
- Confirmed scope: single machine, multiple projects
- Confirmed UI priority: session/time aggregation first
- Discovered Claude Code `SessionEnd` hook - perfect for triggering sync on exit
- Confirmed sync strategy: SessionEnd hook + manual sync button in UI
- Decided server shuts down after sync (not persistent)
- Added subagents table to schema with FK to parent session
- UI will show combined totals; DB supports detailed breakdown for future

---

## Open Questions

1. How should cache tokens factor into cost calculation? (discounted rate?)
2. What date range/retention policy for historical data?
