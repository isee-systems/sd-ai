import express from 'express'
import { currentManifest } from '../../acp/manifestStore.js'

// GET /api/v1/acp/manifest -- the ACP manifest for client applications (see acp/buildManifest.js).
// ?protocol= is the manifest protocol the client speaks (absent: 1); the answer is in that protocol
// while it is supported, and X-ACP-Protocol says which. ?client= and ?clientVersion= identify the
// client; cut-offs are decided by the client from the envelope, so they are informational here.
const router = express.Router()

router.get('/manifest', (req, res) => {
    const manifest = currentManifest(req.query.protocol);
    if (!manifest) {
        // Not built yet. The client falls back to its cache.
        res.set('Retry-After', '60');
        return res.status(503).send({ success: false, message: 'The ACP manifest is not available from this server.' });
    }
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600');
    res.set('X-ACP-Protocol', String(manifest.protocol));
    res.set('ETag', `"${manifest.protocol}-${manifest.serial}"`);
    return res.send(manifest.bytes);
})

export default router;
