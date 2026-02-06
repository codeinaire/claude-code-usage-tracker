import React, { useState, useEffect, useRef } from 'react';

interface ProjectFilterProps {
  onChange: (project: string | null) => void;
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

function getProjectName(project: string): string {
  const trimmed = project.replace(/\/+$/, '');
  const parts = trimmed.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : project;
}

export default function ProjectFilter({ onChange, refreshKey, clearKey }: ProjectFilterProps) {
  const [projects, setProjects] = useState<string[]>([]);
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
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/stats/projects');
        const json = await res.json();
        setProjects(json.projects || []);
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      }
    };
    fetchProjects();
  }, [refreshKey]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelected(value);
    onChange(value || null);
  };

  return (
    <div style={styles.container}>
      <span style={styles.label}>Project:</span>
      <select style={styles.select} value={selected} onChange={handleChange}>
        <option value="">All Projects</option>
        {projects.map((p) => (
          <option key={p} value={p}>
            {getProjectName(p)}
          </option>
        ))}
      </select>
    </div>
  );
}
