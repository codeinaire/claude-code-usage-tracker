# Plan: Skip Zero-Token Sessions & Add Session Delete

## Context
Sessions and subagents with zero tokens (no API calls / no usage data) are being stored in the database, cluttering the sessions table. Additionally, there's no way to delete a session from the UI. This plan adds both features: filtering out zero-token entries during sync, and a delete button per session.

## Changes

### 1. Skip zero-token sessions/subagents during sync
**File:** `src/server/parser/jsonl.ts`

- After parsing a session file, if `messageDataMap` is empty (zero messages = zero tokens), skip the `upsertSession` / `upsertSubagent` and `insertMessages` calls entirely and return early
- This applies to both regular sessions (line ~237) and subagent files (line ~188)
- The early return already exists for "no new data" cases (line 105), so this follows the same pattern

### 2. Add `deleteSession` query function
**File:** `src/server/db/queries.ts`

- Add a new exported function `deleteSession(sessionId: number)` that runs in a transaction:
  1. `DELETE FROM messages WHERE session_id = ?` (deletes both session and subagent messages)
  2. `DELETE FROM subagents WHERE session_id = ?`
  3. `DELETE FROM sessions WHERE id = ?`
- Order matters for foreign key integrity (messages first, then subagents, then session)

### 3. Add DELETE endpoint
**File:** `src/server/routes/stats.ts`

- Add `DELETE /api/stats/sessions/:id` route
- Parse and validate `sessionId` from params
- Call `deleteSession(sessionId)`
- Return `{ ok: true }`
- Import the new `deleteSession` function from queries

### 4. Add delete button to sessions table
**File:** `src/client/components/SessionList.tsx`

- Add a new "Actions" column header at the end of the table
- Add a delete button (trash icon or "X") in each session row in the new column
- On click: show a `window.confirm()` dialog asking "Delete this session and all its subagents?"
- On confirm: call `DELETE /api/stats/sessions/:id`, then remove the session from local `data` state
- Stop event propagation so row click (expand) doesn't fire
- Style the button to match existing UI patterns (subtle, red on hover)
- Also add an empty cell in the subagent rows to keep column alignment

## Files Modified
1. `src/server/parser/jsonl.ts` - Skip zero-token sessions/subagents
2. `src/server/db/queries.ts` - Add `deleteSession()`
3. `src/server/routes/stats.ts` - Add DELETE endpoint
4. `src/client/components/SessionList.tsx` - Add delete button UI
5. `claude-plans/skip-zero-tokens-and-session-delete.md` - Saved plan
6. `CLAUDE.md` - Memory instruction for saving plans

## Verification
1. Run the existing tests: `npm test`
2. Start the dev server and verify:
   - Sync sessions and confirm zero-token sessions no longer appear
   - Click delete on a session -> confirm dialog -> session removed from table
   - Expand a session with subagents -> delete it -> both session and subagents gone
