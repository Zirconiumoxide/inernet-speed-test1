/**
 * GET /api/info — returns the connecting client's IP address
 * and basic server metadata.  No external APIs used.
 */
module.exports = (req, res) => {
    const ip =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.socket?.remoteAddress ||
        'Unknown';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        ip,
        server: 'SpeedPulse (Vercel Edge)',
    });
};
