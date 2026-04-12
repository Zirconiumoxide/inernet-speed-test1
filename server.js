/**
 * SpeedPulse — Self-hosted Internet Speed Test Server
 *
 * Architecture:
 *   - All test data is generated and held in RAM (no disk I/O)
 *   - WebSocket echo for sub-millisecond ping measurement
 *   - HTTP GET  /api/download?bytes=N  → serves N bytes from a pre-allocated buffer
 *   - HTTP POST /api/upload             → receives raw body into RAM, returns byte count
 *   - HTTP GET  /api/info               → returns client IP + server metadata
 *   - Static files served from ./public
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const path = require('path');

// ── Configuration ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;   // 100 MB ceiling
const MAX_UPLOAD_BYTES   = 100 * 1024 * 1024;   // 100 MB ceiling

// ── Pre-allocate the download buffer in RAM ─────────────────────
console.log('[init] Generating 100 MB random download buffer in RAM…');
const downloadBuffer = Buffer.alloc(MAX_DOWNLOAD_BYTES);

// Fill with repeating 1 MB random chunk so compression can't cheat
const randomChunk = crypto.randomBytes(1024 * 1024);
for (let offset = 0; offset < MAX_DOWNLOAD_BYTES; offset += randomChunk.length) {
    randomChunk.copy(
        downloadBuffer,
        offset,
        0,
        Math.min(randomChunk.length, MAX_DOWNLOAD_BYTES - offset)
    );
}
console.log('[init] Download buffer ready ✓');

// ── Express app ─────────────────────────────────────────────────
const app = express();

// Disable compression so raw throughput is measured, not gzip speed
app.disable('x-powered-by');

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/download?bytes=N ───────────────────────────────────
// Sends `N` bytes from the pre-allocated RAM buffer.
app.get('/api/download', (req, res) => {
    let bytes = parseInt(req.query.bytes, 10);
    if (isNaN(bytes) || bytes <= 0) bytes = 1024 * 1024; // default 1 MB
    bytes = Math.min(bytes, MAX_DOWNLOAD_BYTES);

    res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Length': bytes,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Encoding': 'identity',          // prevent proxy compression
        'X-Content-Type-Options': 'nosniff',
    });

    // subarray() returns a zero-copy view — no extra allocation
    res.end(downloadBuffer.subarray(0, bytes));
});

// ── POST /api/upload ────────────────────────────────────────────
// Receives the raw request body into RAM and returns the total
// number of bytes received.
app.post('/api/upload', (req, res) => {
    const chunks = [];          // data stored in RAM as the user requested
    let totalBytes = 0;

    req.on('data', (chunk) => {
        if (totalBytes + chunk.length > MAX_UPLOAD_BYTES) {
            // Reject overly-large uploads
            res.status(413).json({ error: 'Payload too large' });
            req.destroy();
            return;
        }
        chunks.push(chunk);     // keep in RAM
        totalBytes += chunk.length;
    });

    req.on('end', () => {
        // Materialise the full buffer so it truly lives in RAM momentarily
        const uploadedBuffer = Buffer.concat(chunks);
        res.json({ received: uploadedBuffer.length });
        // uploadedBuffer is garbage-collected after this handler returns
    });

    req.on('error', () => {
        res.status(500).json({ error: 'Upload stream error' });
    });
});

// ── GET /api/info ───────────────────────────────────────────────
// Returns the connecting client's IP and basic server metadata.
app.get('/api/info', (req, res) => {
    const ip =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.socket.remoteAddress ||
        'Unknown';

    res.json({
        ip,
        server: 'SpeedPulse',
        uptime: Math.floor(process.uptime()),
    });
});

// ── HTTP server + WebSocket ─────────────────────────────────────
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
    // Ping test: echo every message back immediately
    ws.on('message', (msg) => {
        ws.send(msg);           // instant echo — client measures the RTT
    });
});

// ── Start listening ─────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`\n  ⚡ SpeedPulse server running on http://localhost:${PORT}\n`);
});
