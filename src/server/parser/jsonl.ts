import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  upsertSession,
  upsertSubagent,
  insertMessages,
  getSyncState,
  updateSyncState,
  clearSessionMessagesByExternalId,
  getSessionIdByExternalId,
  cleanupOrphanedSubagentSessions,
  type Message,
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
  message?: {
    id?: string;
    role?: string;
    model?: string;
    usage?: Usage;
  };
  cwd?: string;
  uuid?: string;
  parentUuid?: string;
}

interface ParseResult {
  sessionExternalId: string;
  messagesImported: number;
  project: string | null;
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
      return { sessionExternalId, messagesImported: 0, project };
    }
  } else {
    // Full sync - clear existing messages for this session/subagent
    clearSessionMessagesByExternalId(sessionExternalId);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());

  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let sessionModel: string | null = null;
  let sessionVersion: string | null = null;

  // Use a Map to deduplicate by message ID (streaming chunks have same ID)
  const messageDataMap = new Map<string, {
    externalId: string;
    timestamp: string;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  }>();

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

      // Extract usage data from assistant messages
      if (parsed.type === 'assistant' && parsed.message?.role === 'assistant') {
        const msg = parsed.message;
        if (msg.usage && msg.id) {
          if (msg.model && !sessionModel) {
            sessionModel = msg.model;
          }

          messageDataMap.set(msg.id, {
            externalId: msg.id,
            timestamp: parsed.timestamp || new Date().toISOString(),
            model: msg.model || null,
            inputTokens: msg.usage.input_tokens || 0,
            outputTokens: msg.usage.output_tokens || 0,
            cacheCreationInputTokens: msg.usage.cache_creation_input_tokens || 0,
            cacheReadInputTokens: msg.usage.cache_read_input_tokens || 0,
          });
        }
      }
    } catch {
      // Skip invalid JSON lines
      continue;
    }
  }

  if (isSubagent) {
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

    // Messages belong to the parent session but are tagged with the subagent
    const messages: Message[] = Array.from(messageDataMap.values()).map((data) => ({
      ...data,
      sessionId: parentSessionId!,
      subagentId,
    }));

    if (messages.length > 0) {
      insertMessages(messages);
    }

    updateSyncState(filePath, stats.size);
    return { sessionExternalId, messagesImported: messages.length, project };
  }

  // Regular session file
  const sessionId = upsertSession({
    externalId: sessionExternalId,
    project,
    startTime: firstTimestamp,
    endTime: lastTimestamp,
    model: sessionModel,
    version: sessionVersion,
  });

  const messages: Message[] = Array.from(messageDataMap.values()).map((data) => ({
    ...data,
    sessionId,
    subagentId: null,
  }));

  if (messages.length > 0) {
    insertMessages(messages);
  }

  updateSyncState(filePath, stats.size);
  return { sessionExternalId, messagesImported: messages.length, project };
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
  messagesImported: number;
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

  let totalMessages = 0;
  let totalSessions = 0;

  for (const file of sorted) {
    try {
      const result = parseSessionFile(file, false);
      if (result.messagesImported > 0) {
        totalMessages += result.messagesImported;
        totalSessions++;
      }
    } catch (error) {
      console.error(`Error parsing ${file}:`, error);
    }
  }

  return { sessionsImported: totalSessions, messagesImported: totalMessages };
}
