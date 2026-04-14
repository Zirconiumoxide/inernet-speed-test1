/**
 * GET /api/ping — instant reply for HTTP-based latency measurement.
 * The client records performance.now() before the request and after
 * the response arrives, giving a round-trip time.
 */
module.exports = (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send('p');
};
