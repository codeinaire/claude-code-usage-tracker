import { Router, type Request, type Response } from 'express';
import { getSessionStats, getDailyStats, getSummary, getSubagentsBySessionId, getProjects } from '../db/queries.js';

const router = Router();

// GET /api/stats/projects - List distinct projects
router.get('/projects', (_req: Request, res: Response) => {
  try {
    const projects = getProjects();
    res.json({ projects });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/stats/sessions - List sessions with aggregated totals
router.get('/sessions', (req: Request, res: Response) => {
  try {
    const { from, to, project } = req.query as { from?: string; to?: string; project?: string };
    const sessions = getSessionStats(from, to, project);
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
    const { from, to, project } = req.query as { from?: string; to?: string; project?: string };
    const daily = getDailyStats(from, to, project);
    res.json({ daily });
  } catch (error) {
    console.error('Get daily stats error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/stats/summary - Overall summary
router.get('/summary', (req: Request, res: Response) => {
  try {
    const { project } = req.query as { project?: string };
    const summary = getSummary(project);
    res.json(summary);
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/stats/sessions/:id/subagents - Subagents for a session
router.get('/sessions/:id/subagents', (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    const subagents = getSubagentsBySessionId(sessionId);
    res.json({ subagents });
  } catch (error) {
    console.error('Get subagents error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
