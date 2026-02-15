import React, { useState, useEffect } from 'react';

interface Session {
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
}

interface Subagent {
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

interface SessionListProps {
  dateRange: { from: string; to: string } | null;
  project?: string | null;
  customTitle?: string | null;
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
    tableLayout: 'fixed' as const,
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
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  tdRight: {
    padding: '12px 16px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '14px',
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
  },
  sessionCell: {
    padding: '12px 16px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    overflow: 'hidden',
  },
  sessionId: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#6b7280',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  project: {
    fontSize: '13px',
    color: '#374151',
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    verticalAlign: 'middle',
  },
  empty: {
    padding: '24px',
    textAlign: 'center' as const,
    color: '#9ca3af',
  },
  expandButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '0 4px',
    color: '#6b7280',
    flexShrink: 0,
  },
  subagentRow: {
    background: '#f9fafb',
  },
  subagentTd: {
    padding: '8px 16px 8px 40px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '13px',
    color: '#4b5563',
  },
  subagentTdRight: {
    padding: '8px 16px',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '13px',
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
    color: '#4b5563',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 6px',
    borderRadius: '10px',
    background: '#e0e7ff',
    color: '#4338ca',
    fontSize: '11px',
    fontWeight: 500,
    flexShrink: 0,
  },
  deleteButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '4px 8px',
    borderRadius: '4px',
    color: '#9ca3af',
    transition: 'color 0.15s, background 0.15s',
  },
  editableTitle: {
    fontSize: '13px',
    color: '#374151',
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer',
    borderBottom: '1px dashed #d1d5db',
    verticalAlign: 'middle',
  },
  editableTitleEmpty: {
    fontSize: '13px',
    color: '#9ca3af',
    cursor: 'pointer',
    borderBottom: '1px dashed #d1d5db',
    fontStyle: 'italic' as const,
  },
  titleInput: {
    fontSize: '13px',
    padding: '2px 6px',
    border: '1px solid #2563eb',
    borderRadius: '3px',
    outline: 'none',
    width: '160px',
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

function formatFullDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function formatDuration(startTime: string | null, endTime: string | null): string {
  if (!startTime || !endTime) return '-';
  try {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (isNaN(start) || isNaN(end) || end < start) return '-';
    const minutes = Math.round((end - start) / 60000);
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } catch {
    return '-';
  }
}

function getProjectName(project: string | null): string {
  if (!project) return '-';
  // Remove trailing slash and get the last segment (project name)
  const trimmed = project.replace(/\/+$/, '');
  const parts = trimmed.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '-';
}

export default function SessionList({ dateRange, project, customTitle, refreshKey }: SessionListProps) {
  const [data, setData] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedSessions, setExpandedSessions] = useState<Set<number>>(new Set());
  const [subagentData, setSubagentData] = useState<Record<number, Subagent[]>>({});
  const [loadingSubagents, setLoadingSubagents] = useState<Set<number>>(new Set());
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');

  const saveTitle = async (sessionId: number) => {
    const trimmed = editingTitleValue.trim();
    try {
      await fetch(`/api/stats/sessions/${sessionId}/custom-title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTitle: trimmed || null }),
      });
      setData((prev) =>
        prev.map((s) => s.id === sessionId ? { ...s, customTitle: trimmed || null } : s)
      );
    } catch (err) {
      console.error('Failed to update title:', err);
    }
    setEditingTitleId(null);
  };

  const handleDelete = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this session and all its subagents?')) return;
    try {
      await fetch(`/api/stats/sessions/${sessionId}`, { method: 'DELETE' });
      setData((prev) => prev.filter((s) => s.id !== sessionId));
      setExpandedSessions((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const totalPages = Math.ceil(data.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedData = data.slice(startIndex, startIndex + pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange, project, customTitle, pageSize]);

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
        if (customTitle) {
          params.set('customTitle', customTitle);
        }
        const qs = params.toString();
        const url = '/api/stats/sessions' + (qs ? `?${qs}` : '');
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
  }, [dateRange, project, customTitle, refreshKey]);

  const toggleExpand = async (sessionId: number) => {
    const next = new Set(expandedSessions);
    if (next.has(sessionId)) {
      next.delete(sessionId);
      setExpandedSessions(next);
      return;
    }

    next.add(sessionId);
    setExpandedSessions(next);

    // Fetch subagents if not already loaded
    if (!subagentData[sessionId]) {
      setLoadingSubagents((prev) => new Set(prev).add(sessionId));
      try {
        const res = await fetch(`/api/stats/sessions/${sessionId}/subagents`);
        const json = await res.json();
        setSubagentData((prev) => ({ ...prev, [sessionId]: json.subagents || [] }));
      } catch (err) {
        console.error('Failed to fetch subagents:', err);
        setSubagentData((prev) => ({ ...prev, [sessionId]: [] }));
      } finally {
        setLoadingSubagents((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
    }
  };

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
            <th style={{ ...styles.th, width: '12%' }}>Session</th>
            <th style={{ ...styles.th, width: '14%' }}>Title</th>
            <th style={{ ...styles.th, width: '10%' }}>Project</th>
            <th style={styles.th}>Started</th>
            <th style={styles.th}>Ended</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Duration</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Input</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cache Write</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cache Read</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Output</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Messages</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Cost</th>
            <th style={{ ...styles.th, width: '56px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedData.map((session) => (
            <React.Fragment key={session.id}>
              <tr
                style={session.subagentCount > 0 ? { cursor: 'pointer' } : undefined}
                onClick={session.subagentCount > 0 ? () => toggleExpand(session.id) : undefined}
              >
                <td style={styles.sessionCell}>
                  {session.subagentCount > 0 && (
                    <button
                      style={styles.expandButton}
                      onClick={(e) => { e.stopPropagation(); toggleExpand(session.id); }}
                    >
                      {expandedSessions.has(session.id) ? '\u25BC' : '\u25B6'}
                    </button>
                  )}
                  <span style={styles.sessionId} title={session.externalId}>{session.externalId.slice(0, 8)}...</span>
                  {session.subagentCount > 0 && (
                    <span style={styles.badge}>{session.subagentCount} sub</span>
                  )}
                </td>
                <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                  {editingTitleId === session.id ? (
                    <input
                      style={styles.titleInput}
                      value={editingTitleValue}
                      onChange={(e) => setEditingTitleValue(e.target.value)}
                      onBlur={() => saveTitle(session.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveTitle(session.id);
                        if (e.key === 'Escape') setEditingTitleId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      style={session.customTitle ? styles.editableTitle : styles.editableTitleEmpty}
                      title={session.customTitle ? session.customTitle : 'Click to add title'}
                      onClick={() => {
                        setEditingTitleId(session.id);
                        setEditingTitleValue(session.customTitle || '');
                      }}
                    >
                      {session.customTitle || 'Add title'}
                    </span>
                  )}
                </td>
                <td style={styles.td}>
                  <span style={styles.project} title={session.project || undefined}>
                    {getProjectName(session.project)}
                  </span>
                </td>
                <td style={styles.td} title={formatFullDateTime(session.startTime)}>{formatDateTime(session.startTime)}</td>
                <td style={styles.td} title={formatFullDateTime(session.endTime)}>{formatDateTime(session.endTime)}</td>
                <td style={styles.tdRight}>{formatDuration(session.startTime, session.endTime)}</td>
                <td style={styles.tdRight}>{formatNumber(session.inputTokens)}</td>
                <td style={styles.tdRight}>{formatNumber(session.cacheCreationTokens)}</td>
                <td style={styles.tdRight}>{formatNumber(session.cacheReadTokens)}</td>
                <td style={styles.tdRight}>{formatNumber(session.outputTokens)}</td>
                <td style={styles.tdRight}>{session.messageCount}</td>
                <td style={styles.tdRight}>{formatCurrency(session.estimatedCostUsd)}</td>
                <td style={styles.td}>
                  <button
                    style={styles.deleteButton}
                    title="Delete session"
                    onClick={(e) => handleDelete(session.id, e)}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fef2f2'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'none'; }}
                  >
                    &#x1F5D1;
                  </button>
                </td>
              </tr>
              {expandedSessions.has(session.id) && (
                loadingSubagents.has(session.id) ? (
                  <tr style={styles.subagentRow}>
                    <td colSpan={13} style={styles.subagentTd}>Loading subagents...</td>
                  </tr>
                ) : (
                  (subagentData[session.id] || []).map((sub) => (
                    <tr key={sub.id} style={styles.subagentRow}>
                      <td style={styles.subagentTd}>
                        <span style={styles.sessionId}>{sub.externalId.slice(0, 12)}...</span>
                      </td>
                      <td style={styles.subagentTd}>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>{sub.type || '-'}</span>
                      </td>
                      <td style={styles.subagentTd}></td>
                      <td style={styles.subagentTd} title={formatFullDateTime(sub.startTime)}>{formatDateTime(sub.startTime)}</td>
                      <td style={styles.subagentTd} title={formatFullDateTime(sub.endTime)}>{formatDateTime(sub.endTime)}</td>
                      <td style={styles.subagentTdRight}>{formatDuration(sub.startTime, sub.endTime)}</td>
                      <td style={styles.subagentTdRight}>{formatNumber(sub.inputTokens)}</td>
                      <td style={styles.subagentTdRight}>{formatNumber(sub.cacheCreationTokens)}</td>
                      <td style={styles.subagentTdRight}>{formatNumber(sub.cacheReadTokens)}</td>
                      <td style={styles.subagentTdRight}>{formatNumber(sub.outputTokens)}</td>
                      <td style={styles.subagentTdRight}>{sub.messageCount}</td>
                      <td style={styles.subagentTdRight}>{formatCurrency(sub.estimatedCostUsd)}</td>
                      <td style={styles.subagentTd}></td>
                    </tr>
                  ))
                )
              )}
            </React.Fragment>
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
