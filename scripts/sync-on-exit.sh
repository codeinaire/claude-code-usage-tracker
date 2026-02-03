#!/bin/bash

# Claude Code Usage Tracker - Session End Sync Script
# This script is called by Claude Code's SessionEnd hook
# It reads session data from stdin, syncs to the database, then shuts down

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_URL="http://localhost:3000"
SERVER_PID_FILE="$PROJECT_DIR/data/.server.pid"
STARTUP_TIMEOUT=10

# Read session data from stdin
SESSION_DATA=$(cat)

# Extract transcript_path using jq (or fallback to grep/sed if jq not available)
if command -v jq &> /dev/null; then
    TRANSCRIPT_PATH=$(echo "$SESSION_DATA" | jq -r '.transcript_path // empty')
else
    # Fallback: extract using grep/sed
    TRANSCRIPT_PATH=$(echo "$SESSION_DATA" | grep -o '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)".*/\1/')
fi

if [ -z "$TRANSCRIPT_PATH" ]; then
    echo "No transcript_path found in session data" >&2
    exit 0
fi

# Function to check if server is running
is_server_running() {
    curl -s "$SERVER_URL/api/health" > /dev/null 2>&1
}

# Function to start server if not running
start_server_if_needed() {
    if is_server_running; then
        return 0
    fi

    echo "Starting server..." >&2

    # Start server in background
    cd "$PROJECT_DIR"
    nohup npx tsx src/server/index.ts > "$PROJECT_DIR/data/server.log" 2>&1 &
    echo $! > "$SERVER_PID_FILE"

    # Wait for server to be ready
    for i in $(seq 1 $STARTUP_TIMEOUT); do
        if is_server_running; then
            echo "Server started successfully" >&2
            return 0
        fi
        sleep 1
    done

    echo "Failed to start server within ${STARTUP_TIMEOUT}s" >&2
    return 1
}

# Ensure data directory exists
mkdir -p "$PROJECT_DIR/data"

# Start server if needed
if ! start_server_if_needed; then
    exit 1
fi

# Sync the session
RESPONSE=$(curl -s -X POST "$SERVER_URL/api/sync" \
    -H "Content-Type: application/json" \
    -d "{\"transcriptPath\": \"$TRANSCRIPT_PATH\"}")

if command -v jq &> /dev/null; then
    MESSAGES_IMPORTED=$(echo "$RESPONSE" | jq -r '.messagesImported // 0')
    echo "Synced session: $MESSAGES_IMPORTED messages imported" >&2
else
    echo "Sync response: $RESPONSE" >&2
fi

# Shutdown server
curl -s -X POST "$SERVER_URL/api/shutdown" > /dev/null 2>&1 || true

# Clean up PID file
rm -f "$SERVER_PID_FILE"

exit 0
