import { Router, type Request, type Response } from 'express';
import { getSessionStats, getDailyStats, getSummary, getMonthlyCosts, getSubagentsBySessionId, getProjects, getCustomTitles, updateSessionCustomTitle, deleteSession } from '../db/queries.js';

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

// GET /api/stats/custom-titles - List distinct custom titles
router.get('/custom-titles', (_req: Request, res: Response) => {
  try {
    const customTitles = getCustomTitles();
    res.json({ customTitles });
  } catch (error) {
    console.error('Get custom titles error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/stats/sessions - List sessions with aggregated totals
router.get('/sessions', (req: Request, res: Response) => {
  try {
    const { from, to, project, customTitle } = req.query as { from?: string; to?: string; project?: string; customTitle?: string };
    const sessions = getSessionStats(from, to, project, customTitle);
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
    const { from, to, project, customTitle } = req.query as { from?: string; to?: string; project?: string; customTitle?: string };
    const daily = getDailyStats(from, to, project, customTitle);
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
    const { from, to, project, customTitle } = req.query as { from?: string; to?: string; project?: string; customTitle?: string };
    const summary = getSummary(from, to, project, customTitle);
    res.json(summary);
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/stats/monthly - Monthly costs for subscription comparison
router.get('/monthly', (req: Request, res: Response) => {
  try {
    const { from, to, project, customTitle } = req.query as { from?: string; to?: string; project?: string; customTitle?: string };
    const monthly = getMonthlyCosts(from, to, project, customTitle);
    res.json({ monthly });
  } catch (error) {
    console.error('Get monthly costs error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/stats/sessions/:id/subagents - Subagents for a session
router.get('/sessions/:id/subagents', (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id as string, 10);
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

// PATCH /api/stats/sessions/:id/custom-title - Update a session's custom title
router.patch('/sessions/:id/custom-title', (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id as string, 10);
    if (isNaN(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    const { customTitle } = req.body as { customTitle?: string | null };
    const title = customTitle?.trim() || null;
    updateSessionCustomTitle(sessionId, title);
    res.json({ ok: true, customTitle: title });
  } catch (error) {
    console.error('Update custom title error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// DELETE /api/stats/sessions/:id - Delete a session and all its data
router.delete('/sessions/:id', (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id as string, 10);
    if (isNaN(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    deleteSession(sessionId);
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
