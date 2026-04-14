/**
 * POST /api/upload — receives raw binary data into RAM and returns
 * the total byte count.  Body parsing is disabled so we can stream
 * the request body directly into a Buffer.
 */

async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');

    // Collect the raw request body into RAM
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);   // full upload data in RAM

    res.json({ received: buffer.length });
}

// Disable Vercel's automatic body parser so we receive the raw stream
handler.config = {
    api: {
        bodyParser: false,
    },
};

module.exports = handler;
