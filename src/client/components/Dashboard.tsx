import React, { useState, useEffect, useCallback } from 'react'
import DateRangePicker from './DateRangePicker'
import ProjectFilter from './ProjectFilter'
import DailyStatsTable from './DailyStatsTable'
import SessionList from './SessionList'
import AggregatedStatsCard from './AggregatedStatsCard'

interface Summary {
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  totalCostUsd: number
  costWithoutCacheUsd: number
  sessionCount: number
  firstSession: string | null
  lastSession: string | null
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
  accordionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '18px',
    fontWeight: 600,
    color: '#1a1a1a',
    cursor: 'pointer',
    userSelect: 'none' as const,
    marginBottom: '16px',
  },
  accordionArrow: {
    fontSize: '12px',
    color: '#6b7280',
    transition: 'transform 0.2s',
  },
  error: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#dc2626',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '16px',
  },
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [clearKey, setClearKey] = useState(0)
  const [statsOpen, setStatsOpen] = useState(true)
  const [dailyOpen, setDailyOpen] = useState(true)
  const [sessionsOpen, setSessionsOpen] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(true)

  const fetchSummary = useCallback(async () => {
    try {
      let url = '/api/stats/summary'
      if (projectFilter) {
        url += `?project=${encodeURIComponent(projectFilter)}`
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch summary')
      const data = await res.json()
      setSummary(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [projectFilter])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  const handleSyncAll = async () => {
    setSyncing(true)
    setSyncStatus('Syncing...')
    try {
      const res = await fetch('/api/sync/all', { method: 'POST' })
      if (!res.ok) throw new Error('Sync failed')
      const data = await res.json()
      setSyncStatus(
        `Imported ${data.messagesImported} messages from ${data.sessionsImported} sessions`,
      )
      await fetchSummary()
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setSyncStatus('Sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return <div>Loading...</div>
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

      <div style={styles.section}>
        <div style={styles.accordionHeader} onClick={() => setStatsOpen(!statsOpen)}>
          <span style={{ ...styles.accordionArrow, transform: statsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
          Aggregated Stats
        </div>
        {statsOpen && <AggregatedStatsCard summary={summary} />}
      </div>

      <div style={styles.section}>
        <div style={styles.accordionHeader} onClick={() => setFiltersOpen(!filtersOpen)}>
          <span style={{ ...styles.accordionArrow, transform: filtersOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
          Filters
        </div>
        {filtersOpen && (
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
            <ProjectFilter onChange={setProjectFilter} refreshKey={refreshKey} clearKey={clearKey} />
            <DateRangePicker onChange={setDateRange} clearKey={clearKey} />
            {(projectFilter || dateRange) && (
              <button
                onClick={() => {
                  setProjectFilter(null)
                  setDateRange(null)
                  setClearKey((k) => k + 1)
                }}
                style={{
                  padding: '8px 16px',
                  background: '#f3f4f6',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#6b7280',
                  whiteSpace: 'nowrap',
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.accordionHeader} onClick={() => setDailyOpen(!dailyOpen)}>
          <span style={{ ...styles.accordionArrow, transform: dailyOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
          Daily Usage
        </div>
        {dailyOpen && <DailyStatsTable dateRange={dateRange} project={projectFilter} refreshKey={refreshKey} />}
      </div>

      <div style={styles.section}>
        <div style={styles.accordionHeader} onClick={() => setSessionsOpen(!sessionsOpen)}>
          <span style={{ ...styles.accordionArrow, transform: sessionsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
          Sessions
        </div>
        {sessionsOpen && <SessionList dateRange={dateRange} project={projectFilter} refreshKey={refreshKey} />}
      </div>
    </div>
  )
}
