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

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100];

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
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderTop: '1px solid #e5e7eb',
    background: '#f9fafb',
    fontSize: '14px',
    color: '#6b7280',
  },
  paginationControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  pageButton: {
    padding: '6px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    background: 'white',
    cursor: 'pointer',
    fontSize: '13px',
  },
  pageButtonDisabled: {
    padding: '6px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    background: '#f3f4f6',
    color: '#9ca3af',
    cursor: 'not-allowed',
    fontSize: '13px',
  },
  select: {
    padding: '6px 8px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '13px',
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
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(data.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedData = data.slice(startIndex, startIndex + pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange, project, pageSize]);

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
          {paginatedData.map((row) => (
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
      {data.length > 0 && (
        <div style={styles.pagination}>
          <div>
            Showing {startIndex + 1}-{Math.min(startIndex + pageSize, data.length)} of {data.length} days
          </div>
          <div style={styles.paginationControls}>
            <span>Rows per page:</span>
            <select
              style={styles.select}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <button
              style={currentPage === 1 ? styles.pageButtonDisabled : styles.pageButton}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages || 1}</span>
            <button
              style={currentPage >= totalPages ? styles.pageButtonDisabled : styles.pageButton}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
