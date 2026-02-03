import React, { useState, useEffect } from 'react';

interface Session {
  id: number;
  externalId: string;
  project: string | null;
  startTime: string | null;
  endTime: string | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
}

interface SessionListProps {
  dateRange: { from: string; to: string } | null;
}

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100];

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    overflow: 'hidden',
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
  sessionId: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#6b7280',
  },
  project: {
    fontSize: '13px',
    color: '#374151',
    maxWidth: '200px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  empty: {
    padding: '24px',
    textAlign: 'center' as const,
    color: '#9ca3af',
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

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    const date = new Date(iso);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function getProjectName(project: string | null): string {
  if (!project) return '-';
  // Remove trailing slash and get the last segment (project name)
  const trimmed = project.replace(/\/+$/, '');
  const parts = trimmed.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '-';
}

export default function SessionList({ dateRange }: SessionListProps) {
  const [data, setData] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(data.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedData = data.slice(startIndex, startIndex + pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange, pageSize]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        let url = '/api/stats/sessions';
        if (dateRange) {
          url += `?from=${dateRange.from}&to=${dateRange.to}`;
        }
        const res = await fetch(url);
        const json = await res.json();
        setData(json.sessions || []);
      } catch (err) {
        console.error('Failed to fetch sessions:', err);
        setData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [dateRange]);

  if (loading) {
    return <div style={styles.container}><div style={styles.empty}>Loading...</div></div>;
  }

  if (data.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>No sessions found.</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Session</th>
            <th style={styles.th}>Project</th>
            <th style={styles.th}>Started</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Input</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cache Write</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cache Read</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Output</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Messages</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {paginatedData.map((session) => (
            <tr key={session.id}>
              <td style={styles.td}>
                <span style={styles.sessionId}>{session.externalId.slice(0, 8)}...</span>
              </td>
              <td style={styles.td}>
                <span style={styles.project} title={session.project || undefined}>
                  {getProjectName(session.project)}
                </span>
              </td>
              <td style={styles.td}>{formatDateTime(session.startTime)}</td>
              <td style={styles.tdRight}>{formatNumber(session.inputTokens)}</td>
              <td style={styles.tdRight}>{formatNumber(session.cacheCreationTokens)}</td>
              <td style={styles.tdRight}>{formatNumber(session.cacheReadTokens)}</td>
              <td style={styles.tdRight}>{formatNumber(session.outputTokens)}</td>
              <td style={styles.tdRight}>{session.messageCount}</td>
              <td style={styles.tdRight}>{formatCurrency(session.estimatedCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 0 && (
        <div style={styles.pagination}>
          <div>
            Showing {startIndex + 1}-{Math.min(startIndex + pageSize, data.length)} of {data.length} sessions
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
