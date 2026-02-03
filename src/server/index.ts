import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import syncRoutes from './routes/sync.js';
import statsRoutes from './routes/stats.js';
import { getDb, closeDb } from './db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Initialize database
getDb();

// API Routes
app.use('/api/sync', syncRoutes);
app.use('/api/stats', statsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Shutdown endpoint
app.post('/api/shutdown', (_req, res) => {
  res.json({ success: true, message: 'Server shutting down' });
  setTimeout(() => {
    closeDb();
    process.exit(0);
  }, 100);
});

// Serve static files in production
const clientDist = path.join(__dirname, '../../dist/client');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDb();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  closeDb();
  server.close(() => {
    process.exit(0);
  });
});
