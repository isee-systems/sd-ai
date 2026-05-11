import express from 'express';

export function createHealthRouter(getIsDraining, setIsDraining, sessionManager) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    if (sessionManager.sessions.size > 0)
      return res.status(226).json({status: 'ok', sessions: sessionManager.sessions.size  })
    
    return res.status(200).json({ status: 'ok', sessions: sessionManager.sessions.size  });
  });

  router.get('/lock', (req, res) => {
    const ip = req.socket.remoteAddress;
    // Allow only local/internal calls
    if (ip !== '127.0.0.1' && ip !== '::1') {
      return res.status(403).send('Only direct server calls allowed');
    }

    const token = req.headers['x-internal-secret'];
    if (token !== process.env.INTERNAL_SECRET) {
      return res.status(403).send('Unauthorized');
    }

    if (getIsDraining()) {
      return res.status(200).json({
        status: 'draining',
        sessions: sessionManager.sessions.size
      });
    }

    setIsDraining(true);
    res.status(200).json({ 
      status: 'ready',
      sessions: sessionManager.sessions.size 
    });
  });

  return router;
}