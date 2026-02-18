import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  upsertSession,
  upsertSubagent,
  insertUsageRecords,
  insertExchanges,
  getSyncState,
  updateSyncState,
  clearSessionUsageRecordsByExternalId,
  clearSessionExchangesByExternalId,
  getSessionIdByExternalId,
  cleanupOrphanedSubagentSessions,
  type UsageRecord,
  type Exchange,
} from '../db/queries.js';

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AssistantMessage {
  model?: string;
  usage?: Usage;
}

interface JsonlLine {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  version?: string;
  customTitle?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    usage?: Usage;
    content?: string | Array<{ type?: string; text?: string }>;
  };
  cwd?: string;
  uuid?: string;
  parentUuid?: string;
}

interface ParseResult {
  sessionExternalId: string;
  usageRecordsImported: number;
  exchangesImported: number;
  project: string | null;
}

function extractUserContent(message: JsonlLine['message']): string | null {
  if (!message) return null;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    const textPart = message.content.find((c) => c.type === 'text');
    return textPart?.text || null;
  }
  return null;
}

export function isSubagentFile(filePath: string): boolean {
  return filePath.includes(`${path.sep}subagents${path.sep}`) || filePath.includes('/subagents/');
}

export function extractParentSessionExternalId(filePath: string): string | null {
  // Path format: .../{session-uuid}/subagents/agent-xxx.jsonl
  // The parent session UUID is the directory two levels above the file
  const parts = filePath.split(path.sep);
  const subagentsIdx = parts.lastIndexOf('subagents');
  if (subagentsIdx < 1) return null;
  return parts[subagentsIdx - 1];
}

export function extractProjectFromPath(filePath: string): string | null {
  // Path format: ~/.claude/projects/{encoded-project-path}/{session-id}.jsonl
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!filePath.startsWith(projectsDir)) {
    return null;
  }

  const relativePath = filePath.slice(projectsDir.length + 1);
  const parts = relativePath.split(path.sep);
  if (parts.length >= 1) {
    // Decode the project path (e.g., "-Users-foo-bar" -> "/Users/foo/bar")
    return parts[0].replace(/-/g, '/');
  }
  return null;
}

export function extractSessionExternalIdFromPath(filePath: string): string {
  const basename = path.basename(filePath, '.jsonl');
  return basename;
}

export function parseSessionFile(
  filePath: string,
  incrementalSync: boolean = true
): ParseResult {
  const sessionExternalId = extractSessionExternalIdFromPath(filePath);
  const project = extractProjectFromPath(filePath);
  const isSubagent = isSubagentFile(filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const syncState = getSyncState(filePath);

  let startOffset = 0;
  if (incrementalSync && syncState) {
    startOffset = syncState.lastOffset;
    if (startOffset >= stats.size) {
      // No new data
      return { sessionExternalId, usageRecordsImported: 0, exchangesImported: 0, project };
    }
  } else {
    // Full sync - clear existing records for this session/subagent
    clearSessionUsageRecordsByExternalId(sessionExternalId);
    if (!isSubagent) {
      clearSessionExchangesByExternalId(sessionExternalId);
    }
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());

  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let sessionModel: string | null = null;
  let sessionVersion: string | null = null;
  let sessionCustomTitle: string | null = null;

  // Use a Map to deduplicate by message ID (streaming chunks have same ID)
  const usageRecordMap = new Map<string, {
    externalId: string;
    timestamp: string;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  }>();

  // Turn tracking: user → assistant turn boundaries for accurate duration
  interface TurnStart {
    timestamp: string;
    uuid: string | null;
    content: string | null;
  }
  let turnStart: TurnStart | null = null;
  let turnEnd: string | null = null;
  let lastAssistantMsgId: string | null = null;
  const exchangesList: Exchange[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as JsonlLine;

      // Skip non-message lines (file-history-snapshot, etc.)
      if (parsed.type === 'file-history-snapshot') {
        continue;
      }

      // Extract timestamps from any message type
      if (parsed.timestamp) {
        if (!firstTimestamp || parsed.timestamp < firstTimestamp) {
          firstTimestamp = parsed.timestamp;
        }
        if (!lastTimestamp || parsed.timestamp > lastTimestamp) {
          lastTimestamp = parsed.timestamp;
        }
      }

      // Extract session metadata
      if (parsed.sessionId && parsed.sessionId === sessionExternalId) {
        if (parsed.version && !sessionVersion) {
          sessionVersion = parsed.version;
        }
      }

      // Extract custom title
      if (parsed.customTitle && !sessionCustomTitle) {
        sessionCustomTitle = parsed.customTitle;
      }

      // Turn tracking: detect user→assistant boundaries (main session only, not subagent lines)
      if (!isSubagent && parsed.type === 'user' && parsed.message?.role === 'user' && !parsed.isMeta && !parsed.isSidechain) {
        // Flush previous turn if we have both start and end
        if (turnStart !== null && turnEnd !== null) {
          const durationSeconds =
            (new Date(turnEnd).getTime() - new Date(turnStart.timestamp).getTime()) / 1000;
          exchangesList.push({
            sessionId: 0, // filled in after session upsert
            userMessageUuid: turnStart.uuid,
            userTimestamp: turnStart.timestamp,
            assistantMessageId: lastAssistantMsgId,
            assistantLastTimestamp: turnEnd,
            durationSeconds: durationSeconds >= 0 ? durationSeconds : null,
            userContent: turnStart.content,
          });
        }
        turnStart = {
          timestamp: parsed.timestamp || new Date().toISOString(),
          uuid: parsed.uuid || null,
          content: extractUserContent(parsed.message),
        };
        turnEnd = null;
        lastAssistantMsgId = null;
      }

      // Extract usage data from assistant messages
      if (parsed.type === 'assistant' && parsed.message?.role === 'assistant') {
        const msg = parsed.message;
        if (msg.usage && msg.id) {
          if (msg.model && !sessionModel) {
            sessionModel = msg.model;
          }

          usageRecordMap.set(msg.id, {
            externalId: msg.id,
            timestamp: parsed.timestamp || new Date().toISOString(),
            model: msg.model || null,
            inputTokens: msg.usage.input_tokens || 0,
            outputTokens: msg.usage.output_tokens || 0,
            cacheCreationInputTokens: msg.usage.cache_creation_input_tokens || 0,
            cacheReadInputTokens: msg.usage.cache_read_input_tokens || 0,
          });

          // Track turn end (last assistant chunk wins, same as dedup logic)
          if (!isSubagent && !parsed.isSidechain) {
            turnEnd = parsed.timestamp || new Date().toISOString();
            lastAssistantMsgId = msg.id;
          }
        }
      }
    } catch {
      // Skip invalid JSON lines
      continue;
    }
  }

  // Flush final turn
  if (!isSubagent && turnStart !== null && turnEnd !== null) {
    const durationSeconds =
      (new Date(turnEnd).getTime() - new Date(turnStart.timestamp).getTime()) / 1000;
    exchangesList.push({
      sessionId: 0, // filled in after session upsert
      userMessageUuid: turnStart.uuid,
      userTimestamp: turnStart.timestamp,
      assistantMessageId: lastAssistantMsgId,
      assistantLastTimestamp: turnEnd,
      durationSeconds: durationSeconds >= 0 ? durationSeconds : null,
      userContent: turnStart.content,
    });
  }

  if (isSubagent) {
    // Skip subagent files with zero messages (no API calls / no usage data)
    if (usageRecordMap.size === 0) {
      updateSyncState(filePath, stats.size);
      return { sessionExternalId, usageRecordsImported: 0, exchangesImported: 0, project };
    }

    // Route into subagents table
    const parentExternalId = extractParentSessionExternalId(filePath);
    if (!parentExternalId) {
      throw new Error(`Cannot extract parent session ID from subagent file: ${filePath}`);
    }

    // Ensure the parent session exists (upsert with minimal data)
    let parentSessionId = getSessionIdByExternalId(parentExternalId);
    if (parentSessionId === null) {
      parentSessionId = upsertSession({
        externalId: parentExternalId,
        project,
        startTime: null,
        endTime: null,
        model: null,
        version: null,
        customTitle: sessionCustomTitle,
      });
    }

    // Extract subagent type from filename (e.g., "agent-xxx" -> the full basename)
    const subagentType = sessionModel || null;

    // Upsert subagent and get the internal ID
    const subagentId = upsertSubagent(
      sessionExternalId,
      parentSessionId,
      subagentType,
      firstTimestamp,
      lastTimestamp
    );

    // Records belong to the parent session but are tagged with the subagent
    const records: UsageRecord[] = Array.from(usageRecordMap.values()).map((data) => ({
      ...data,
      sessionId: parentSessionId!,
      subagentId,
    }));

    if (records.length > 0) {
      insertUsageRecords(records);
    }

    updateSyncState(filePath, stats.size);
    return { sessionExternalId, usageRecordsImported: records.length, exchangesImported: 0, project };
  }

  // Skip session files with zero messages (no API calls / no usage data)
  if (usageRecordMap.size === 0) {
    updateSyncState(filePath, stats.size);
    return { sessionExternalId, usageRecordsImported: 0, exchangesImported: 0, project };
  }

  // Regular session file
  const sessionId = upsertSession({
    externalId: sessionExternalId,
    project,
    startTime: firstTimestamp,
    endTime: lastTimestamp,
    model: sessionModel,
    version: sessionVersion,
    customTitle: sessionCustomTitle,
  });

  const records: UsageRecord[] = Array.from(usageRecordMap.values()).map((data) => ({
    ...data,
    sessionId,
    subagentId: null,
  }));

  if (records.length > 0) {
    insertUsageRecords(records);
  }

  // Fill in sessionId for exchanges and insert
  const exchangesWithSessionId = exchangesList.map((ex) => ({ ...ex, sessionId }));
  let exchangesImported = 0;
  if (exchangesWithSessionId.length > 0) {
    exchangesImported = insertExchanges(exchangesWithSessionId);
  }

  // Warn if usage records were found but no exchanges detected (format change indicator)
  if (records.length > 0 && exchangesWithSessionId.length === 0) {
    console.warn(
      `[parser] No exchanges detected in ${filePath} despite ${records.length} usage records — JSONL format may have changed`
    );
  }

  updateSyncState(filePath, stats.size);

  // After parsing a main session file, also sync any subagent files
  let subagentUsageRecords = 0;
  const subagentDir = path.join(path.dirname(filePath), sessionExternalId, 'subagents');
  if (fs.existsSync(subagentDir)) {
    const subagentFiles = fs.readdirSync(subagentDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(subagentDir, f));

    for (const subFile of subagentFiles) {
      try {
        const subResult = parseSessionFile(subFile, incrementalSync);
        subagentUsageRecords += subResult.usageRecordsImported;
      } catch (error) {
        console.error(`Error parsing subagent file ${subFile}:`, error);
      }
    }
  }

  return {
    sessionExternalId,
    usageRecordsImported: records.length + subagentUsageRecords,
    exchangesImported,
    project,
  };
}

export function findAllSessionFiles(): string[] {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const sessionFiles: string[] = [];

  if (!fs.existsSync(projectsDir)) {
    return sessionFiles;
  }

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        sessionFiles.push(fullPath);
      }
    }
  }

  walkDir(projectsDir);
  return sessionFiles;
}

export function syncAllSessions(): {
  sessionsImported: number;
  usageRecordsImported: number;
} {
  // Clean up orphaned session entries that were previously created for subagent files
  cleanupOrphanedSubagentSessions();

  const files = findAllSessionFiles();

  // Parse parent session files before subagent files so parent sessions exist
  const sorted = [...files].sort((a, b) => {
    const aIsSub = isSubagentFile(a) ? 1 : 0;
    const bIsSub = isSubagentFile(b) ? 1 : 0;
    return aIsSub - bIsSub;
  });

  let totalUsageRecords = 0;
  let totalSessions = 0;

  for (const file of sorted) {
    try {
      const result = parseSessionFile(file, false);
      if (result.usageRecordsImported > 0) {
        totalUsageRecords += result.usageRecordsImported;
        totalSessions++;
      }
    } catch (error) {
      console.error(`Error parsing ${file}:`, error);
    }
  }

  return { sessionsImported: totalSessions, usageRecordsImported: totalUsageRecords };
}
