import React, { useState, useEffect, useCallback } from 'react';
import DateRangePicker from './DateRangePicker';
import DailyStatsTable from './DailyStatsTable';
import SessionList from './SessionList';

interface Summary {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCostUsd: number;
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
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  card: {
    background: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  cardLabel: {
    fontSize: '12px',
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  cardValue: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#1a1a1a',
  },
  cardSubvalue: {
    fontSize: '12px',
    color: '#888',
    marginTop: '4px',
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

function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(2) + 'M';
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(1) + 'K';
  }
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  return '$' + n.toFixed(2);
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);

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

      <div style={styles.cards}>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Input Tokens</div>
          <div style={styles.cardValue}>
            {summary ? formatNumber(summary.inputTokens) : '-'}
          </div>
          <div style={styles.cardSubvalue}>Base input tokens</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Cache Write Tokens</div>
          <div style={styles.cardValue}>
            {summary ? formatNumber(summary.cacheCreationTokens) : '-'}
          </div>
          <div style={styles.cardSubvalue}>125% of input price</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Cache Read Tokens</div>
          <div style={styles.cardValue}>
            {summary ? formatNumber(summary.cacheReadTokens) : '-'}
          </div>
          <div style={styles.cardSubvalue}>10% of input price</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Output Tokens</div>
          <div style={styles.cardValue}>
            {summary ? formatNumber(summary.outputTokens) : '-'}
          </div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Estimated Cost</div>
          <div style={styles.cardValue}>
            {summary ? formatCurrency(summary.totalCostUsd) : '-'}
          </div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Sessions</div>
          <div style={styles.cardValue}>{summary?.sessionCount ?? '-'}</div>
          {summary?.firstSession && summary?.lastSession && (
            <div style={styles.cardSubvalue}>
              {summary.firstSession} to {summary.lastSession}
            </div>
          )}
        </div>
      </div>

      <div style={styles.section}>
        <DateRangePicker onChange={setDateRange} />
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Daily Usage</h2>
        <DailyStatsTable dateRange={dateRange} />
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Sessions</h2>
        <SessionList dateRange={dateRange} />
      </div>
    </div>
  );
}
