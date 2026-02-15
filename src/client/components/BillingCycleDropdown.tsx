import React, { useState, useEffect, useRef } from 'react'

interface BillingCycleDropdownProps {
  onReset: (from: string, to: string) => void
  onClear: () => void
}

function getBillingCycle(startDate: string): { periodStart: string; periodEnd: string; nextPayment: string } {
  const start = new Date(startDate + 'T00:00:00')
  const billingDay = start.getUTCDate()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const year = today.getFullYear()
  const month = today.getMonth()

  // Current period start: the billing day this month or last month
  let periodStart: Date
  const thisMonthBillingDay = new Date(year, month, billingDay)
  if (today >= thisMonthBillingDay) {
    periodStart = thisMonthBillingDay
  } else {
    periodStart = new Date(year, month - 1, billingDay)
  }

  // Next payment: one month after period start
  const nextPayment = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, billingDay)
  // Period end: day before next payment
  const periodEnd = new Date(nextPayment)
  periodEnd.setDate(periodEnd.getDate() - 1)

  return {
    periodStart: formatDate(periodStart),
    periodEnd: formatDate(periodEnd),
    nextPayment: formatDate(nextPayment),
  }
}

function formatDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDisplay(dateStr: string): string {
  const [year, m, d] = dateStr.split('-')
  const date = new Date(parseInt(year), parseInt(m) - 1, parseInt(d))
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
  },
  button: {
    padding: '10px 20px',
    background: 'white',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  menu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: '4px',
    background: 'white',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 10,
    minWidth: '280px',
    padding: '16px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '6px',
  },
  dateInput: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '14px',
    color: '#374151',
    boxSizing: 'border-box' as const,
  },
  cycleInfo: {
    fontSize: '14px',
    color: '#374151',
    marginBottom: '4px',
  },
  cycleLabel: {
    fontWeight: 600,
    color: '#6b7280',
    fontSize: '12px',
  },
  divider: {
    borderTop: '1px solid #e5e7eb',
    margin: '12px 0',
  },
  actionButton: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    cursor: 'pointer',
    fontSize: '14px',
    color: '#374151',
    borderRadius: '4px',
  },
  primaryAction: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    textAlign: 'left' as const,
    cursor: 'pointer',
    fontSize: '14px',
    borderRadius: '4px',
    fontWeight: 500,
  },
  dangerAction: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    cursor: 'pointer',
    fontSize: '14px',
    color: '#dc2626',
    borderRadius: '4px',
  },
}

export default function BillingCycleDropdown({ onReset, onClear }: BillingCycleDropdownProps) {
  const [open, setOpen] = useState(false)
  const [subscriptionDate, setSubscriptionDate] = useState<string | null>(null)
  const [inputDate, setInputDate] = useState('')
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.subscription_start_date) {
          setSubscriptionDate(data.subscription_start_date)
          setInputDate(data.subscription_start_date)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const saveDate = async (date: string) => {
    try {
      const res = await fetch('/api/settings/subscription-start-date', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      if (res.ok) {
        setSubscriptionDate(date)
      }
    } catch (err) {
      console.error('Failed to save subscription date:', err)
    }
  }

  const clearDate = async () => {
    try {
      const res = await fetch('/api/settings/subscription-start-date', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: null }),
      })
      if (res.ok) {
        setSubscriptionDate(null)
        setInputDate('')
      }
    } catch (err) {
      console.error('Failed to clear subscription date:', err)
    }
  }

  const handleSave = () => {
    if (inputDate && /^\d{4}-\d{2}-\d{2}$/.test(inputDate)) {
      saveDate(inputDate)
    }
  }

  const handleReset = () => {
    if (!subscriptionDate) return
    const { periodStart, periodEnd } = getBillingCycle(subscriptionDate)
    onReset(periodStart, periodEnd)
    setOpen(false)
  }

  const handleShowAll = () => {
    onClear()
    setOpen(false)
  }

  if (loading) return null

  const cycle = subscriptionDate ? getBillingCycle(subscriptionDate) : null

  return (
    <div style={styles.wrapper} ref={ref}>
      <button
        style={styles.button}
        onClick={() => setOpen(!open)}
      >
        Billing Cycle &#9662;
      </button>
      {open && (
        <div style={styles.menu}>
          <div style={styles.label}>Subscription Start Date</div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              type="date"
              style={styles.dateInput}
              value={inputDate}
              onChange={(e) => setInputDate(e.target.value)}
            />
            <button
              style={{
                ...styles.primaryAction,
                width: 'auto',
                padding: '8px 16px',
                whiteSpace: 'nowrap',
              }}
              onClick={handleSave}
              disabled={!inputDate}
            >
              Save
            </button>
          </div>

          {cycle && subscriptionDate && (
            <>
              <div style={styles.divider} />
              <div style={styles.cycleLabel}>Current Billing Period</div>
              <div style={styles.cycleInfo}>
                {formatDisplay(cycle.periodStart)} &ndash; {formatDisplay(cycle.periodEnd)}
              </div>
              <div style={{ ...styles.cycleLabel, marginTop: '8px' }}>Next Payment</div>
              <div style={styles.cycleInfo}>{formatDisplay(cycle.nextPayment)}</div>

              <div style={styles.divider} />
              <button
                style={styles.primaryAction}
                onClick={handleReset}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1d4ed8')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#2563eb')}
              >
                Reset to Current Period
              </button>
              <button
                style={{ ...styles.actionButton, marginTop: '4px' }}
                onClick={handleShowAll}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                Show All Data
              </button>
              <button
                style={{ ...styles.dangerAction, marginTop: '4px' }}
                onClick={clearDate}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                Clear Start Date
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
