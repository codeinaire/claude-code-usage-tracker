import React, { useState, useEffect, useCallback } from 'react';
import DateRangePicker from './DateRangePicker';
import DailyStatsTable from './DailyStatsTable';
import SessionList from './SessionList';
import AggregatedStatsCard from './AggregatedStatsCard';

interface Summary {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  costWithoutCacheUsd: number;
  sessionCount: number;
  firstSession: string | null;
  lastSession: string | null;
}

const styles: Record<string, React.CSSProperties> = {
  actions: {
    marginBottom: '24px',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  button: {
    padding: '10px 20px',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  status: {
    fontSize: '14px',
    color: '#666',
  },
  section: {
    marginBottom: '32px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '16px',
    color: '#1a1a1a',
  },
  error: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#dc2626',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '16px',
  },
};

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/stats/summary');
      if (!res.ok) throw new Error('Failed to fetch summary');
      const data = await res.json();
      setSummary(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncStatus('Syncing...');
    try {
      const res = await fetch('/api/sync/all', { method: 'POST' });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      setSyncStatus(
        `Imported ${data.messagesImported} messages from ${data.sessionsImported} sessions`
      );
      await fetchSummary();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setSyncStatus('Sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div style={styles.actions}>
        <button
          style={{
            ...styles.button,
            ...(syncing ? styles.buttonDisabled : {}),
          }}
          onClick={handleSyncAll}
          disabled={syncing}
        >
          {syncing ? 'Syncing...' : 'Sync All Sessions'}
        </button>
        {syncStatus && <span style={styles.status}>{syncStatus}</span>}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <AggregatedStatsCard summary={summary} />

      <div style={styles.section}>
        <DateRangePicker onChange={setDateRange} />
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Daily Usage</h2>
        <DailyStatsTable dateRange={dateRange} refreshKey={refreshKey} />
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Sessions</h2>
        <SessionList dateRange={dateRange} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
