import React, { useState } from 'react';

interface DateRangePickerProps {
  onChange: (range: { from: string; to: string } | null) => void;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  label: {
    fontSize: '14px',
    color: '#666',
  },
  input: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
  button: {
    padding: '8px 16px',
    background: '#f3f4f6',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  quickSelect: {
    display: 'flex',
    gap: '8px',
    marginLeft: '16px',
  },
  quickButton: {
    padding: '6px 12px',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#4b5563',
  },
};

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export default function DateRangePicker({ onChange }: DateRangePickerProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const handleApply = () => {
    if (from && to) {
      onChange({ from, to });
    } else if (!from && !to) {
      onChange(null);
    }
  };

  const handleClear = () => {
    setFrom('');
    setTo('');
    onChange(null);
  };

  const setQuickRange = (days: number) => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    setFrom(formatDate(startDate));
    setTo(formatDate(endDate));
    onChange({ from: formatDate(startDate), to: formatDate(endDate) });
  };

  return (
    <div style={styles.container}>
      <span style={styles.label}>From:</span>
      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        style={styles.input}
      />
      <span style={styles.label}>To:</span>
      <input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        style={styles.input}
      />
      <button onClick={handleApply} style={styles.button}>
        Apply
      </button>
      <button onClick={handleClear} style={styles.button}>
        Clear
      </button>

      <div style={styles.quickSelect}>
        <button onClick={() => setQuickRange(7)} style={styles.quickButton}>
          Last 7 days
        </button>
        <button onClick={() => setQuickRange(30)} style={styles.quickButton}>
          Last 30 days
        </button>
        <button onClick={() => setQuickRange(90)} style={styles.quickButton}>
          Last 90 days
        </button>
      </div>
    </div>
  );
}
