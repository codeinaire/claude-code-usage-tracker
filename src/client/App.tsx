import React from 'react';
import Dashboard from './components/Dashboard';

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    marginTop: '4px',
  },
};

export default function App() {
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Claude Code Usage Tracker</h1>
        <p style={styles.subtitle}>Track your token usage and estimated costs</p>
      </header>
      <Dashboard />
    </div>
  );
}
