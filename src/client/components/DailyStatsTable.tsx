import React, { useState, useEffect } from 'react';

interface DailyStats {
  date: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
  sessionCount: number;
  messageCount: number;
}

interface DailyStatsTableProps {
  dateRange: { from: string; to: string } | null;
  project?: string | null;
  refreshKey?: number;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
  },
  td: {
    padding: '12px 16px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '14px',
  },
  tdRight: {
    padding: '12px 16px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '14px',
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
  },
  empty: {
    padding: '24px',
    textAlign: 'center' as const,
    color: '#9ca3af',
  },
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  return '$' + n.toFixed(2);
}

export default function DailyStatsTable({ dateRange, project, refreshKey }: DailyStatsTableProps) {
  const [data, setData] = useState<DailyStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (dateRange) {
          params.set('from', dateRange.from);
          params.set('to', dateRange.to);
        }
        if (project) {
          params.set('project', project);
        }
        const qs = params.toString();
        const url = '/api/stats/daily' + (qs ? `?${qs}` : '');
        const res = await fetch(url);
        const json = await res.json();
        setData(json.daily || []);
      } catch (err) {
        console.error('Failed to fetch daily stats:', err);
        setData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [dateRange, project, refreshKey]);

  if (loading) {
    return <div style={styles.container}><div style={styles.empty}>Loading...</div></div>;
  }

  if (data.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>No data available. Click "Sync All Sessions" to import data.</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Date</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Input</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cache Write</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cache Read</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Output</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Sessions</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Messages</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.date}>
              <td style={styles.td}>{row.date}</td>
              <td style={styles.tdRight}>{formatNumber(row.inputTokens)}</td>
              <td style={styles.tdRight}>{formatNumber(row.cacheCreationTokens)}</td>
              <td style={styles.tdRight}>{formatNumber(row.cacheReadTokens)}</td>
              <td style={styles.tdRight}>{formatNumber(row.outputTokens)}</td>
              <td style={styles.tdRight}>{row.sessionCount}</td>
              <td style={styles.tdRight}>{row.messageCount}</td>
              <td style={styles.tdRight}>{formatCurrency(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
