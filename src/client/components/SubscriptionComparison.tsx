import React, { useState, useEffect } from 'react'

interface MonthlyCost {
  month: string
  apiCostUsd: number
  sessionCount: number
  messageCount: number
}

interface SubscriptionComparisonProps {
  project: string | null
  customTitle: string | null
  refreshKey: number
}

const PLANS = [
  { name: 'Pro', price: 20 },
  { name: 'Max 5x', price: 100 },
  { name: 'Max 20x', price: 200 },
] as const

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    marginBottom: '16px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    background: 'white',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    fontSize: '14px',
  },
  th: {
    textAlign: 'left',
    padding: '12px 16px',
    background: '#f9fafb',
    borderBottom: '2px solid #e5e7eb',
    fontWeight: 600,
    color: '#374151',
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  thRight: {
    textAlign: 'right',
    padding: '12px 16px',
    background: '#f9fafb',
    borderBottom: '2px solid #e5e7eb',
    fontWeight: 600,
    color: '#374151',
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  td: {
    padding: '10px 16px',
    borderBottom: '1px solid #f3f4f6',
    color: '#374151',
  },
  tdRight: {
    padding: '10px 16px',
    borderBottom: '1px solid #f3f4f6',
    color: '#374151',
    textAlign: 'right',
  },
  totalRow: {
    fontWeight: 600,
    background: '#f9fafb',
  },
  positive: {
    color: '#16a34a',
    fontWeight: 500,
  },
  negative: {
    color: '#dc2626',
    fontWeight: 500,
  },
  summaryCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
    marginBottom: '20px',
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
  },
  cardSubvalue: {
    fontSize: '12px',
    color: '#888',
    marginTop: '4px',
  },
  cardPrice: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '8px',
  },
}

function formatCurrency(n: number): string {
  return '$' + n.toFixed(2)
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-')
  const date = new Date(parseInt(year), parseInt(m) - 1)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
}

export default function SubscriptionComparison({ project, customTitle, refreshKey }: SubscriptionComparisonProps) {
  const [monthly, setMonthly] = useState<MonthlyCost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams()
    if (project) params.set('project', project)
    if (customTitle) params.set('customTitle', customTitle)
    const qs = params.toString()
    const url = '/api/stats/monthly' + (qs ? `?${qs}` : '')

    fetch(url)
      .then((res) => res.json())
      .then((data) => setMonthly(data.monthly))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [project, customTitle, refreshKey])

  if (loading) return <div>Loading...</div>
  if (monthly.length === 0) return <div style={{ color: '#6b7280' }}>No monthly data available.</div>

  const totalApiCost = monthly.reduce((sum, m) => sum + m.apiCostUsd, 0)
  const numMonths = monthly.length

  return (
    <div style={styles.wrapper}>
      {/* Summary cards per plan */}
      <div style={styles.summaryCards}>
        {PLANS.map((plan) => {
          const totalSubCost = numMonths * plan.price
          const savings = totalApiCost - totalSubCost
          const saved = savings > 0
          return (
            <div key={plan.name} style={styles.card}>
              <div style={styles.cardLabel}>{plan.name}</div>
              <div style={styles.cardPrice}>{formatCurrency(plan.price)}/mo</div>
              <div style={{ ...styles.cardValue, color: saved ? '#16a34a' : '#dc2626' }}>
                {saved ? '+' : ''}{formatCurrency(savings)}
              </div>
              <div style={styles.cardSubvalue}>
                {saved
                  ? `Saved vs API over ${numMonths} month${numMonths > 1 ? 's' : ''}`
                  : `Overpaid vs API over ${numMonths} month${numMonths > 1 ? 's' : ''}`}
              </div>
              <div style={styles.cardSubvalue}>
                API: {formatCurrency(totalApiCost)} vs Sub: {formatCurrency(totalSubCost)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Monthly breakdown table */}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Month</th>
            <th style={styles.thRight}>API Cost</th>
            {PLANS.map((plan) => (
              <th key={plan.name} style={styles.thRight}>
                vs {plan.name} ({formatCurrency(plan.price)}/mo)
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthly.map((row) => (
            <tr key={row.month}>
              <td style={styles.td}>{formatMonth(row.month)}</td>
              <td style={styles.tdRight}>{formatCurrency(row.apiCostUsd)}</td>
              {PLANS.map((plan) => {
                const diff = row.apiCostUsd - plan.price
                const saved = diff > 0
                return (
                  <td key={plan.name} style={{ ...styles.tdRight, ...(saved ? styles.positive : styles.negative) }}>
                    {saved ? '+' : ''}{formatCurrency(diff)}
                  </td>
                )
              })}
            </tr>
          ))}
          {/* Totals row */}
          <tr style={styles.totalRow}>
            <td style={styles.td}>Total ({numMonths} mo)</td>
            <td style={styles.tdRight}>{formatCurrency(totalApiCost)}</td>
            {PLANS.map((plan) => {
              const diff = totalApiCost - numMonths * plan.price
              const saved = diff > 0
              return (
                <td key={plan.name} style={{ ...styles.tdRight, ...(saved ? styles.positive : styles.negative) }}>
                  {saved ? '+' : ''}{formatCurrency(diff)}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
