import { Router, type Request, type Response } from 'express';
import { getAllSettings, getSetting, setSetting } from '../db/queries.js';

const router = Router();

// GET /api/settings - Return all settings
router.get('/', (_req: Request, res: Response) => {
  try {
    const settings = getAllSettings();
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// PUT /api/settings/subscription-start-date - Save subscription start date
router.put('/subscription-start-date', (req: Request, res: Response) => {
  try {
    const { date } = req.body as { date?: string | null };
    if (date === null || date === undefined || date === '') {
      setSetting('subscription_start_date', null);
      res.json({ ok: true, date: null });
      return;
    }
    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      return;
    }
    setSetting('subscription_start_date', date);
    res.json({ ok: true, date });
  } catch (error) {
    console.error('Set subscription start date error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
