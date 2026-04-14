/**
 * GET /api/download?bytes=N — generates N bytes of random data in RAM
 * and sends it to the client.  Capped at 4 MB per request to stay
 * within Vercel's serverless response-body limit.
 *
 * Data is random so CDN / proxy compression cannot cheat the measurement.
 */
const crypto = require('crypto');

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB ceiling (Vercel limit)

module.exports = (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let bytes = parseInt(req.query.bytes, 10);
    if (isNaN(bytes) || bytes <= 0) bytes = 1024 * 1024;
    bytes = Math.min(bytes, MAX_BYTES);

    // Generate random data in RAM — 64 KB seed repeated to fill buffer
    const seed   = crypto.randomBytes(65536);
    const buffer = Buffer.alloc(bytes);
    for (let i = 0; i < bytes; i += seed.length) {
        seed.copy(buffer, i, 0, Math.min(seed.length, bytes - i));
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', bytes);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Origin', '*');

    res.end(buffer);
};
