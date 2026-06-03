import express from 'express';

export function createHealthRouter(sessionManager) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    if (sessionManager.sessions.size > 0)
      return res.status(226).json({status: 'ok', sessions: sessionManager.sessions.size  })

    return res.status(200).json({ status: 'ok', sessions: sessionManager.sessions.size  });
  });

  return router;
}