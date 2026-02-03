import { Router, type Request, type Response } from 'express';
import { parseSessionFile, syncAllSessions } from '../parser/jsonl.js';

const router = Router();

interface SyncRequest {
  transcriptPath: string;
}

// POST /api/sync - Sync a single session
router.post('/', (req: Request, res: Response) => {
  try {
    const { transcriptPath } = req.body as SyncRequest;

    if (!transcriptPath) {
      res.status(400).json({ success: false, error: 'transcriptPath is required' });
      return;
    }

    const result = parseSessionFile(transcriptPath, true);
    res.json({
      success: true,
      sessionExternalId: result.sessionExternalId,
      messagesImported: result.messagesImported,
      project: result.project,
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/sync/all - Import all sessions
router.post('/all', (_req: Request, res: Response) => {
  try {
    const result = syncAllSessions();
    res.json({
      success: true,
      sessionsImported: result.sessionsImported,
      messagesImported: result.messagesImported,
    });
  } catch (error) {
    console.error('Sync all error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
