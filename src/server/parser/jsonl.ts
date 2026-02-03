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
    // Full sync - clear existing messages for this session
    clearSessionMessagesByExternalId(sessionExternalId);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());

  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let sessionModel: string | null = null;
  let sessionVersion: string | null = null;

  // Use a Map to deduplicate by message ID (streaming chunks have same ID)
  // Store message external IDs temporarily, will resolve session ID after upsert
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

      // Extract session metadata from any message type
      if (parsed.sessionId && parsed.sessionId === sessionExternalId) {
        if (parsed.version && !sessionVersion) {
          sessionVersion = parsed.version;
        }
        if (parsed.timestamp) {
          if (!firstTimestamp || parsed.timestamp < firstTimestamp) {
            firstTimestamp = parsed.timestamp;
          }
          if (!lastTimestamp || parsed.timestamp > lastTimestamp) {
            lastTimestamp = parsed.timestamp;
          }
        }
      }

      // Extract usage data from assistant messages
      if (parsed.type === 'assistant' && parsed.message?.role === 'assistant') {
        const msg = parsed.message;
        if (msg.usage && msg.id) {
          if (msg.model && !sessionModel) {
            sessionModel = msg.model;
          }

          // Use message ID as key to deduplicate streaming chunks
          // Later chunks overwrite earlier ones (they have the same or updated totals)
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

  // Upsert session and get the internal ID
  const sessionId = upsertSession({
    externalId: sessionExternalId,
    project,
    startTime: firstTimestamp,
    endTime: lastTimestamp,
    model: sessionModel,
    version: sessionVersion,
  });

  // Convert message data to full Message objects with session ID
  const messages: Message[] = Array.from(messageDataMap.values()).map((data) => ({
    ...data,
    sessionId,
    subagentId: null,
  }));

  // Insert messages
  if (messages.length > 0) {
    insertMessages(messages);
  }

  // Update sync state
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
  const files = findAllSessionFiles();
  let totalMessages = 0;
  let totalSessions = 0;

  for (const file of files) {
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
