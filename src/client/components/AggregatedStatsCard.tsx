import React from 'react'
import { CgMathPlus } from 'react-icons/cg'
import { CgMathEqual } from 'react-icons/cg'

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

interface AggregatedStatsCardProps {
  summary: Summary | null
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 200px 30px)',
    gap: '16px',
    marginBottom: '32px',
  },
  sectionHeader: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#374151',
    padding: '8px 0 0',
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
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(2) + 'M'
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(1) + 'K'
  }
  return n.toLocaleString()
}

function formatCurrency(n: number): string {
  return '$' + n.toFixed(2)
}

export default function AggregatedStatsCard({ summary }: AggregatedStatsCardProps) {
  return (
    <div style={styles.grid}>
      {/* Row 1: Input Token Stats header */}
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={styles.sectionHeader}>Input Token Stats</div>
      </div>

      {/* Row 2: Input token items */}
      <div style={styles.card}>
        <div style={styles.cardLabel}>Total Input Tokens</div>
        <div style={styles.cardValue}>
          {summary
            ? formatNumber(
                summary.inputTokens + summary.cacheCreationTokens + summary.cacheReadTokens,
              )
            : '-'}
        </div>
      </div>
      <div style={{ alignSelf: 'center', justifySelf: 'center' }}>
        <CgMathEqual size={24} color="#888" />
      </div>
      <div style={styles.card}>
        <div style={styles.cardLabel}>Input Tokens</div>
        <div style={styles.cardValue}>{summary ? formatNumber(summary.inputTokens) : '-'}</div>
        <div style={styles.cardSubvalue}>Base input tokens</div>
      </div>
      <div style={{ alignSelf: 'center', justifySelf: 'center' }}>
        <CgMathPlus size={24} color="#888" />
      </div>
      <div style={styles.card}>
        <div style={styles.cardLabel}>Cache Write Tokens</div>
        <div style={styles.cardValue}>
          {summary ? formatNumber(summary.cacheCreationTokens) : '-'}
        </div>
        <div style={styles.cardSubvalue}>125% of input price</div>
      </div>
      <div style={{ alignSelf: 'center', justifySelf: 'center' }}>
        <CgMathPlus size={24} color="#888" />
      </div>
      <div style={styles.card}>
        <div style={styles.cardLabel}>Cache Read Tokens</div>
        <div style={styles.cardValue}>{summary ? formatNumber(summary.cacheReadTokens) : '-'}</div>
        <div style={styles.cardSubvalue}>10% of input price</div>
      </div>

      {/* Row 3: Cost Stats header */}
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={styles.sectionHeader}>Cost Stats</div>
      </div>

      {/* Row 4: Cost & Cache Efficiency items */}
      <div style={styles.card}>
        <div style={styles.cardLabel}>Estimated Cost</div>
        <div style={styles.cardValue}>{summary ? formatCurrency(summary.totalCostUsd) : '-'}</div>
        {summary && summary.costWithoutCacheUsd > 0 && (
          <div style={styles.cardSubvalue}>
            {formatCurrency(summary.costWithoutCacheUsd)} without caching
          </div>
        )}
      </div>
      <div />
      <div style={styles.card}>
        <div style={styles.cardLabel}>Money Saved</div>
        <div
          style={{
            ...styles.cardValue,
            color:
              summary && summary.costWithoutCacheUsd > summary.totalCostUsd ? '#16a34a' : '#1a1a1a',
          }}
        >
          {summary ? formatCurrency(summary.costWithoutCacheUsd - summary.totalCostUsd) : '-'}
        </div>
        <div style={styles.cardSubvalue}>
          {summary && summary.costWithoutCacheUsd > 0
            ? `${((1 - summary.totalCostUsd / summary.costWithoutCacheUsd) * 100).toFixed(1)}% cheaper via caching`
            : 'From prompt caching'}
        </div>
      </div>
      <div />
      <div style={styles.card}>
        <div style={styles.cardLabel}>Cache Hit Rate</div>
        <div style={{ ...styles.cardValue, color: '#2563eb' }}>
          {summary && summary.cacheReadTokens + summary.cacheCreationTokens > 0
            ? `${((summary.cacheReadTokens / (summary.cacheReadTokens + summary.cacheCreationTokens)) * 100).toFixed(1)}%`
            : '-'}
        </div>
        <div style={styles.cardSubvalue}>
          {summary
            ? `${formatNumber(summary.cacheReadTokens)} reads / ${formatNumber(summary.cacheReadTokens + summary.cacheCreationTokens)} total cached`
            : 'Cache reads vs writes'}
        </div>
      </div>
      <div />
      <div style={styles.card}>
        <div style={styles.cardLabel}>Cache Efficiency</div>
        <div style={{ ...styles.cardValue, color: '#9333ea' }}>
          {summary &&
          summary.inputTokens + summary.cacheCreationTokens + summary.cacheReadTokens > 0
            ? `${((summary.cacheReadTokens / (summary.inputTokens + summary.cacheCreationTokens + summary.cacheReadTokens)) * 100).toFixed(1)}%`
            : '-'}
        </div>
        <div style={styles.cardSubvalue}>Of all input served from cache</div>
      </div>

      {/* Row 5: Misc header */}
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={styles.sectionHeader}>Misc</div>
      </div>

      {/* Row 6: Output tokens & Sessions */}
      <div style={styles.card}>
        <div style={styles.cardLabel}>Output Tokens</div>
        <div style={styles.cardValue}>{summary ? formatNumber(summary.outputTokens) : '-'}</div>
      </div>
      <div />
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
  )
}
