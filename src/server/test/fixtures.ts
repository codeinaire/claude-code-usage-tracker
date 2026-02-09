/** A minimal valid JSONL session with 2 assistant messages (Sonnet 4) */
export const BASIC_SESSION_JSONL = [
  '{"type":"user","sessionId":"abc-123","timestamp":"2026-01-15T10:00:00.000Z","version":"1.2.3","message":{"role":"user","content":"hello"}}',
  '{"type":"assistant","sessionId":"abc-123","timestamp":"2026-01-15T10:00:02.000Z","message":{"id":"msg-a1","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":200,"cache_read_input_tokens":100}}}',
  '{"type":"user","sessionId":"abc-123","timestamp":"2026-01-15T10:00:10.000Z","message":{"role":"user","content":"next question"}}',
  '{"type":"assistant","sessionId":"abc-123","timestamp":"2026-01-15T10:00:12.000Z","message":{"id":"msg-a2","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":2000,"output_tokens":800,"cache_creation_input_tokens":300,"cache_read_input_tokens":500}}}',
].join('\n');

/** JSONL with streaming deduplication: same message ID appears 3 times with increasing tokens */
export const STREAMING_DEDUP_JSONL = [
  '{"type":"user","sessionId":"stream-001","timestamp":"2026-01-15T11:00:00.000Z","message":{"role":"user","content":"hi"}}',
  '{"type":"assistant","sessionId":"stream-001","timestamp":"2026-01-15T11:00:01.000Z","message":{"id":"msg-stream","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
  '{"type":"assistant","sessionId":"stream-001","timestamp":"2026-01-15T11:00:01.500Z","message":{"id":"msg-stream","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
  '{"type":"assistant","sessionId":"stream-001","timestamp":"2026-01-15T11:00:02.000Z","message":{"id":"msg-stream","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"output_tokens":200,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
].join('\n');

/** JSONL with custom title */
export const SESSION_WITH_TITLE_JSONL = [
  '{"type":"user","sessionId":"titled-001","timestamp":"2026-01-16T09:00:00.000Z","customTitle":"Fix login bug","version":"1.3.0","message":{"role":"user","content":"fix this"}}',
  '{"type":"assistant","sessionId":"titled-001","timestamp":"2026-01-16T09:00:05.000Z","message":{"id":"msg-t1","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":500,"output_tokens":200,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
].join('\n');

/** JSONL with file-history-snapshot lines that should be skipped */
export const SESSION_WITH_SKIPPABLE_JSONL = [
  '{"type":"user","sessionId":"skip-001","timestamp":"2026-01-15T12:00:00.000Z","message":{"role":"user","content":"test"}}',
  '{"type":"file-history-snapshot","messageId":"snap-1","snapshot":{"messageId":"snap-1","trackedFileBackups":{},"timestamp":"2026-01-15T12:00:01.000Z"},"isSnapshotUpdate":false}',
  '{"type":"assistant","sessionId":"skip-001","timestamp":"2026-01-15T12:00:02.000Z","message":{"id":"msg-s1","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":800,"output_tokens":300,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
].join('\n');

/** JSONL with invalid JSON lines mixed in */
export const SESSION_WITH_INVALID_LINES_JSONL = [
  '{"type":"user","sessionId":"bad-001","timestamp":"2026-01-15T13:00:00.000Z","message":{"role":"user","content":"test"}}',
  'this is not valid json {{{',
  '{"type":"assistant","sessionId":"bad-001","timestamp":"2026-01-15T13:00:01.000Z","message":{"id":"msg-b1","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":400,"output_tokens":150,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
  '',
].join('\n');

/** Sonnet 4.5 session -- for testing tiered pricing (under 200K threshold) */
export const SONNET_45_SESSION_JSONL = [
  '{"type":"user","sessionId":"s45-001","timestamp":"2026-01-17T10:00:00.000Z","message":{"role":"user","content":"test"}}',
  '{"type":"assistant","sessionId":"s45-001","timestamp":"2026-01-17T10:00:01.000Z","message":{"id":"msg-s45","role":"assistant","model":"claude-sonnet-4-5-20250514","usage":{"input_tokens":10000,"output_tokens":5000,"cache_creation_input_tokens":2000,"cache_read_input_tokens":3000}}}',
].join('\n');

/** Sonnet 4.5 session -- over 200K context for higher tier pricing */
export const SONNET_45_HIGH_CONTEXT_JSONL = [
  '{"type":"user","sessionId":"s45h-001","timestamp":"2026-01-17T11:00:00.000Z","message":{"role":"user","content":"test"}}',
  '{"type":"assistant","sessionId":"s45h-001","timestamp":"2026-01-17T11:00:01.000Z","message":{"id":"msg-s45h","role":"assistant","model":"claude-sonnet-4-5-20250514","usage":{"input_tokens":150000,"output_tokens":5000,"cache_creation_input_tokens":30000,"cache_read_input_tokens":25000}}}',
].join('\n');

/** Opus 4.5 session */
export const OPUS_45_SESSION_JSONL = [
  '{"type":"user","sessionId":"o45-001","timestamp":"2026-01-18T10:00:00.000Z","message":{"role":"user","content":"test"}}',
  '{"type":"assistant","sessionId":"o45-001","timestamp":"2026-01-18T10:00:01.000Z","message":{"id":"msg-o45","role":"assistant","model":"claude-opus-4-5-20250514","usage":{"input_tokens":10000,"output_tokens":5000,"cache_creation_input_tokens":2000,"cache_read_input_tokens":3000}}}',
].join('\n');

/** Haiku 4.5 session */
export const HAIKU_45_SESSION_JSONL = [
  '{"type":"user","sessionId":"h45-001","timestamp":"2026-01-18T11:00:00.000Z","message":{"role":"user","content":"test"}}',
  '{"type":"assistant","sessionId":"h45-001","timestamp":"2026-01-18T11:00:01.000Z","message":{"id":"msg-h45","role":"assistant","model":"claude-haiku-4-5-20250514","usage":{"input_tokens":10000,"output_tokens":5000,"cache_creation_input_tokens":2000,"cache_read_input_tokens":3000}}}',
].join('\n');

/** Subagent session JSONL */
export const SUBAGENT_JSONL = [
  '{"type":"user","sessionId":"agent-sub-001","timestamp":"2026-01-15T10:01:00.000Z","isSidechain":true,"agentId":"sub-001","message":{"role":"user","content":"subagent task"}}',
  '{"type":"assistant","sessionId":"agent-sub-001","timestamp":"2026-01-15T10:01:01.000Z","isSidechain":true,"agentId":"sub-001","message":{"id":"msg-sa1","role":"assistant","model":"claude-haiku-4-5-20250514","usage":{"input_tokens":600,"output_tokens":250,"cache_creation_input_tokens":0,"cache_read_input_tokens":50}}}',
].join('\n');
