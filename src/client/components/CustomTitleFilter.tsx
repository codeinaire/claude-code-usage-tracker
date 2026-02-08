import React, { useState, useEffect, useRef } from 'react';

interface CustomTitleFilterProps {
  onChange: (customTitle: string | null) => void;
  refreshKey?: number;
  clearKey?: number;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  label: {
    fontSize: '14px',
    color: '#666',
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    minWidth: '200px',
    background: 'white',
  },
};

export default function CustomTitleFilter({ onChange, refreshKey, clearKey }: CustomTitleFilterProps) {
  const [titles, setTitles] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setSelected('');
  }, [clearKey]);

  useEffect(() => {
    const fetchTitles = async () => {
      try {
        const res = await fetch('/api/stats/custom-titles');
        const json = await res.json();
        setTitles(json.customTitles || []);
      } catch (err) {
        console.error('Failed to fetch custom titles:', err);
      }
    };
    fetchTitles();
  }, [refreshKey]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelected(value);
    onChange(value || null);
  };

  return (
    <div style={styles.container}>
      <span style={styles.label}>Title:</span>
      <select style={styles.select} value={selected} onChange={handleChange}>
        <option value="">All Titles</option>
        {titles.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}
