import { Router, type Request, type Response } from 'express';
import { getSessionStats, getDailyStats, getSummary } from '../db/queries.js';

const router = Router();

// GET /api/stats/sessions - List sessions with aggregated totals
router.get('/sessions', (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const sessions = getSessionStats(from, to);
    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/stats/daily - Daily aggregated stats
router.get('/daily', (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const daily = getDailyStats(from, to);
    res.json({ daily });
  } catch (error) {
    console.error('Get daily stats error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/stats/summary - Overall summary
router.get('/summary', (_req: Request, res: Response) => {
  try {
    const summary = getSummary();
    res.json(summary);
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
