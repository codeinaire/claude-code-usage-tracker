export interface DateRange {
  from: string;
  to: string;
}

export interface SessionStats {
  id: number;
  externalId: string;
  project: string | null;
  customTitle: string | null;
  startTime: string | null;
  endTime: string | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
  subagentCount: number;
  durationSeconds: number;
  claudeActiveSeconds: number;
}

export interface SubagentStats {
  id: number;
  externalId: string;
  type: string | null;
  startTime: string | null;
  endTime: string | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
}

export interface DailyStats {
  date: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
  sessionCount: number;
  messageCount: number;
}

export interface Summary {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  costWithoutCacheUsd: number;
  sessionCount: number;
  messageCount: number;
  totalHours: number;
  claudeActiveHours: number;
  firstSession: string | null;
  lastSession: string | null;
}

export interface MonthlyCost {
  month: string;
  apiCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionCount: number;
  messageCount: number;
}
