/**
 * SpeedPulse — Client-Side Speed Test Engine + Canvas Gauge
 *
 * How it works (all data stays in RAM, zero external APIs):
 *
 * 1.  PING   — Open a WebSocket to the server; send a tiny "p" byte, server
 *              echoes it instantly.  Client measures the round-trip time.
 *              20 samples, first 3 discarded (warm-up), median + jitter.
 *
 * 2.  DOWNLOAD — Multiple parallel HTTP GETs to /api/download?bytes=N.
 *               Server slices from a pre-allocated 100 MB RAM buffer.
 *               Client stores each response as an ArrayBuffer (RAM).
 *               Adaptive chunk sizing, 10-second test window, trimmed mean.
 *
 * 3.  UPLOAD  — Multiple parallel HTTP POSTs of ArrayBuffer data (RAM).
 *               Server collects chunks into a Buffer (RAM), replies with
 *               byte-count.  Same adaptive sizing and averaging.
 */

(function () {
    'use strict';

    // ============================================================
    //  CONFIGURATION
    // ============================================================
    const CFG = {
        // ── Endpoints ─────────────────────────────
        PING_URL:     '/api/ping',

        // ── Endpoints ─────────────────────────────
        DOWNLOAD_URL: '/api/download',
        UPLOAD_URL:   '/api/upload',
        INFO_URL:     '/api/info',

        // ── Ping ──────────────────────────────────
        PING_TOTAL:   20,
        PING_WARMUP:  3,

        // ── Download ──────────────────────────────
        DL_DURATION:      10_000,        // ms
        DL_CONCURRENCY:   6,
        DL_INIT_CHUNK:    2 * 1024 * 1024,
        DL_MAX_CHUNK:     25 * 1024 * 1024,
        DL_MIN_CHUNK:     256 * 1024,

        // ── Upload ────────────────────────────────
        UL_DURATION:      10_000,
        UL_CONCURRENCY:   4,
        UL_INIT_CHUNK:    1 * 1024 * 1024,
        UL_MAX_CHUNK:     20 * 1024 * 1024,
        UL_MIN_CHUNK:     128 * 1024,

        // ── Gauge geometry ────────────────────────
        GAUGE_START:  0.75 * Math.PI,     // 135° — lower-left
        GAUGE_END:    2.25 * Math.PI,     // 405° — lower-right
        GAUGE_ARC:    1.5  * Math.PI,     // 270° sweep
    };

    // ============================================================
    //  GAUGE (Canvas)
    // ============================================================
    class Gauge {
        constructor(canvasId, wrapperId) {
            this.canvas  = document.getElementById(canvasId);
            this.wrapper = document.getElementById(wrapperId);
            this.ctx     = this.canvas.getContext('2d');

            this.current  = 0;
            this.target   = 0;
            this.maxScale = 100;
            this._raf     = null;

            this._resize();
            window.addEventListener('resize', () => this._resize());
            this._loop();
        }

        /* Responsive DPI-aware canvas */
        _resize() {
            const dpr  = window.devicePixelRatio || 1;
            const rect = this.wrapper.getBoundingClientRect();
            const size = rect.width;

            this.canvas.width  = size * dpr;
            this.canvas.height = size * dpr;
            this.canvas.style.width  = size + 'px';
            this.canvas.style.height = size + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            this.S  = size;
            this.cx = size / 2;
            this.cy = size / 2;
            this.R  = size * 0.40;      // arc radius
        }

        /* Auto-pick scale ceiling */
        _autoScale(v) {
            if (v <= 50)   return 50;
            if (v <= 100)  return 100;
            if (v <= 250)  return 250;
            if (v <= 500)  return 500;
            return 1000;
        }

        setTarget(speed) {
            this.target = speed;
            const s = this._autoScale(speed);
            if (s > this.maxScale) this.maxScale = s;
        }

        reset() {
            this.current  = 0;
            this.target   = 0;
            this.maxScale = 100;
        }

        /* ── Drawing ────────────────────────────── */
        _loop() {
            this.current += (this.target - this.current) * 0.09;
            this._draw();
            this._raf = requestAnimationFrame(() => this._loop());
        }

        _draw() {
            const { ctx, cx, cy, R, S, maxScale } = this;
            const { GAUGE_START, GAUGE_END, GAUGE_ARC } = CFG;

            ctx.clearRect(0, 0, S, S);

            const lineW = Math.max(14, S * 0.055);

            // ── Background arc ──────────────────
            ctx.beginPath();
            ctx.arc(cx, cy, R, GAUGE_START, GAUGE_END);
            ctx.strokeStyle = 'rgba(255,255,255,0.055)';
            ctx.lineWidth = lineW;
            ctx.lineCap = 'round';
            ctx.stroke();

            // ── Active arc ──────────────────────
            const frac = Math.min(Math.max(this.current / maxScale, 0), 1);
            const activeEnd = GAUGE_START + frac * GAUGE_ARC;

            if (frac > 0.002) {
                // Glow layer
                ctx.save();
                ctx.shadowColor = '#00d4ff';
                ctx.shadowBlur  = 25;
                ctx.beginPath();
                ctx.arc(cx, cy, R, GAUGE_START, activeEnd);

                let grad;
                if (typeof ctx.createConicGradient === 'function') {
                    grad = ctx.createConicGradient(GAUGE_START, cx, cy);
                    grad.addColorStop(0,     '#00d4ff');
                    grad.addColorStop(0.375, '#7c3aed');
                    grad.addColorStop(0.75,  '#ec4899');
                    grad.addColorStop(1,     '#ec4899');
                } else {
                    grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
                    grad.addColorStop(0,   '#00d4ff');
                    grad.addColorStop(0.5, '#7c3aed');
                    grad.addColorStop(1,   '#ec4899');
                }

                ctx.strokeStyle = grad;
                ctx.lineWidth   = lineW;
                ctx.lineCap     = 'round';
                ctx.stroke();
                ctx.restore();
            }

            // ── Tick marks ──────────────────────
            this._drawTicks(ctx);
        }

        _drawTicks(ctx) {
            const { cx, cy, R, maxScale } = this;
            const { GAUGE_START, GAUGE_ARC } = CFG;
            const TOTAL = 50;
            const MAJOR = 10;

            for (let i = 0; i <= TOTAL; i++) {
                const frac  = i / TOTAL;
                const angle = GAUGE_START + frac * GAUGE_ARC;
                const major = i % MAJOR === 0;

                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const inner = R - (major ? 26 : 20);
                const outer = R - 12;

                ctx.beginPath();
                ctx.moveTo(cx + inner * cos, cy + inner * sin);
                ctx.lineTo(cx + outer * cos, cy + outer * sin);
                ctx.strokeStyle = major
                    ? 'rgba(255,255,255,0.45)'
                    : 'rgba(255,255,255,0.12)';
                ctx.lineWidth = major ? 2 : 1;
                ctx.lineCap = 'round';
                ctx.stroke();

                if (major) {
                    const lr = R - 36;
                    const v  = Math.round(frac * maxScale);
                    ctx.font = `600 ${Math.max(10, this.S * 0.033)}px "Inter", sans-serif`;
                    ctx.fillStyle = 'rgba(255,255,255,0.45)';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(v, cx + lr * cos, cy + lr * sin);
                }
            }
        }

        destroy() { cancelAnimationFrame(this._raf); }
    }

    // ============================================================
    //  SPEED-TEST ENGINE
    // ============================================================
    class SpeedTest {
        constructor() {
            // DOM refs
            this.btn           = document.getElementById('start-btn');
            this.btnText       = document.getElementById('btn-text');
            this.btnIcon       = document.getElementById('btn-icon');
            this.speedVal      = document.getElementById('speed-value');
            this.speedUnit     = document.getElementById('speed-unit');
            this.phaseLabel    = document.getElementById('test-phase');
            this.pingVal       = document.getElementById('ping-value');
            this.jitterVal     = document.getElementById('jitter-value');
            this.dlVal         = document.getElementById('download-value');
            this.ulVal         = document.getElementById('upload-value');
            this.progressWrap  = document.getElementById('progress-bar-wrapper');
            this.progressFill  = document.getElementById('progress-bar-fill');
            this.progressLabel = document.getElementById('progress-label');

            this.gauge = new Gauge('gauge-canvas', 'gauge-wrapper');
            this.ws    = null;
            this.busy  = false;

            this.btn.addEventListener('click', () => this.run());
            this._fetchInfo();
            this._detectConnection();
        }

        // ── Server info ────────────────────────
        async _fetchInfo() {
            try {
                const r = await fetch(CFG.INFO_URL);
                const d = await r.json();
                document.getElementById('ip-info').textContent = d.ip || 'Unknown';
            } catch {
                document.getElementById('ip-info').textContent = 'Unavailable';
            }
        }

        _detectConnection() {
            const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (c) {
                const parts = [];
                if (c.effectiveType) parts.push(c.effectiveType.toUpperCase());
                if (c.downlink)      parts.push(`~${c.downlink} Mbps est.`);
                document.getElementById('connection-info').textContent =
                    parts.join(' · ') || '—';
            }
        }

        // ── UI Helpers ─────────────────────────
        _setPhase(name, label) {
            document.body.className = `phase-${name}`;
            this.phaseLabel.textContent = label;
            this.phaseLabel.classList.toggle('active', name !== 'ready' && name !== 'complete');
        }

        _setProgress(pct) {
            this.progressFill.style.width = `${Math.min(pct, 100)}%`;
            this.progressLabel.textContent = `${Math.round(pct)} %`;
        }

        _revealCard(id, value) {
            const el = document.getElementById(id);
            el.classList.add('revealed');
        }

        _resetUI() {
            ['card-ping', 'card-jitter', 'card-download', 'card-upload']
                .forEach(id => document.getElementById(id).classList.remove('revealed'));
            this.pingVal.textContent = '—';
            this.jitterVal.textContent = '—';
            this.dlVal.textContent = '—';
            this.ulVal.textContent = '—';
            this.speedVal.textContent = '0';
            this.speedUnit.textContent = 'Mbps';
            this._setProgress(0);
            this.gauge.reset();
        }

        _fmtSpeed(mbps) {
            if (mbps >= 100) return mbps.toFixed(0);
            if (mbps >= 10)  return mbps.toFixed(1);
            return mbps.toFixed(2);
        }

        // ── Main Test Runner ───────────────────
        async run() {
            if (this.busy) return;
            this.busy = true;
            this._resetUI();

            this.btn.disabled = true;
            this.btn.classList.add('testing');
            this.btnText.textContent = 'Testing…';
            this.progressWrap.classList.add('visible');

            try {
                // 1 — PING
                this._setPhase('ping', 'Measuring Latency…');
                const ping = await this._testPing();
                this.pingVal.textContent   = ping.median.toFixed(1);
                this.jitterVal.textContent = ping.jitter.toFixed(1);
                this._revealCard('card-ping');
                this._revealCard('card-jitter');

                // 2 — DOWNLOAD
                this._setPhase('download', 'Measuring Download…');
                this.gauge.reset();
                const dl = await this._testDownload();
                this.dlVal.textContent = this._fmtSpeed(dl);
                this._revealCard('card-download');

                // 3 — UPLOAD
                this._setPhase('upload', 'Measuring Upload…');
                this.gauge.reset();
                const ul = await this._testUpload();
                this.ulVal.textContent = this._fmtSpeed(ul);
                this._revealCard('card-upload');

                // Done
                this._setPhase('complete', 'Test Complete');
                this.speedVal.textContent = this._fmtSpeed(dl);
                this.speedUnit.textContent = 'Mbps';
                this.gauge.setTarget(dl);

            } catch (err) {
                console.error('Speed test failed:', err);
                this._setPhase('error', 'Test Failed — Check Console');
            } finally {
                this.busy = false;
                this.btn.disabled = false;
                this.btn.classList.remove('testing');
                this.btnText.textContent = 'Test Again';
                this.progressWrap.classList.remove('visible');
                if (this.ws) { this.ws.close(); this.ws = null; }
            }
        }

        // ============================================================
        //  1.  PING  (HTTP Fetch fallback since Vercel doesn't do WS)
        // ============================================================
        async _testPing() {
            const samples = [];
            let count = 0;

            while (count < CFG.PING_TOTAL) {
                const t0 = performance.now();
                try {
                    await fetch(CFG.PING_URL, { cache: 'no-store' });
                } catch (e) {
                    throw new Error('Ping request failed');
                }
                const rtt = performance.now() - t0;

                if (count >= CFG.PING_WARMUP) {
                    samples.push(rtt);
                }
                count++;

                // Update gauge with current ping
                this.speedVal.textContent = rtt.toFixed(1);
                this.speedUnit.textContent = 'ms';
                this._setProgress((count / CFG.PING_TOTAL) * 30);
            }

            // Median
            samples.sort((a, b) => a - b);
            const median = samples[Math.floor(samples.length / 2)];

            // Jitter (mean of consecutive absolute differences)
            let jSum = 0;
            for (let i = 1; i < samples.length; i++)
                jSum += Math.abs(samples[i] - samples[i - 1]);
            const jitter = samples.length > 1
                ? jSum / (samples.length - 1)
                : 0;

            return { median, jitter, samples };
        }

        // ============================================================
        //  2.  DOWNLOAD  (parallel HTTP GETs, data stored in RAM)
        // ============================================================
        async _testDownload() {
            const measurements = [];
            const t0 = performance.now();
            let chunk = CFG.DL_INIT_CHUNK;

            while (performance.now() - t0 < CFG.DL_DURATION) {
                const batchT0 = performance.now();

                // Fire N parallel downloads
                const promises = [];
                for (let i = 0; i < CFG.DL_CONCURRENCY; i++) {
                    promises.push(
                        fetch(`${CFG.DOWNLOAD_URL}?bytes=${chunk}`, { cache: 'no-store' })
                            .then(r => r.arrayBuffer())     // data held in RAM
                    );
                }

                const buffers  = await Promise.all(promises);
                const batchT1  = performance.now();
                const totalB   = buffers.reduce((s, b) => s + b.byteLength, 0);
                const duration = (batchT1 - batchT0) / 1000;
                const mbps     = (totalB * 8) / duration / 1_000_000;

                measurements.push(mbps);
                this.gauge.setTarget(mbps);
                this.speedVal.textContent = this._fmtSpeed(mbps);
                this.speedUnit.textContent = 'Mbps';

                const elapsed = performance.now() - t0;
                this._setProgress(30 + (elapsed / CFG.DL_DURATION) * 35);

                // Adaptive chunk sizing
                if (duration < 1)       chunk = Math.min(chunk * 2,           CFG.DL_MAX_CHUNK);
                else if (duration > 3)  chunk = Math.max(Math.floor(chunk * 0.6), CFG.DL_MIN_CHUNK);
            }

            return this._trimmedMean(measurements);
        }

        // ============================================================
        //  3.  UPLOAD  (parallel HTTP POSTs, server stores in RAM)
        // ============================================================
        async _testUpload() {
            const measurements = [];
            const t0 = performance.now();
            let chunk = CFG.UL_INIT_CHUNK;

            while (performance.now() - t0 < CFG.UL_DURATION) {
                const batchT0 = performance.now();

                const promises = [];
                for (let i = 0; i < CFG.UL_CONCURRENCY; i++) {
                    // Data generated and held in browser RAM
                    const data = new ArrayBuffer(chunk);
                    promises.push(
                        fetch(CFG.UPLOAD_URL, {
                            method: 'POST',
                            body: data,
                            headers: { 'Content-Type': 'application/octet-stream' },
                        })
                    );
                }

                await Promise.all(promises);
                const batchT1  = performance.now();
                const totalB   = chunk * CFG.UL_CONCURRENCY;
                const duration = (batchT1 - batchT0) / 1000;
                const mbps     = (totalB * 8) / duration / 1_000_000;

                measurements.push(mbps);
                this.gauge.setTarget(mbps);
                this.speedVal.textContent = this._fmtSpeed(mbps);
                this.speedUnit.textContent = 'Mbps';

                const elapsed = performance.now() - t0;
                this._setProgress(65 + (elapsed / CFG.UL_DURATION) * 35);

                if (duration < 1)       chunk = Math.min(chunk * 2,           CFG.UL_MAX_CHUNK);
                else if (duration > 3)  chunk = Math.max(Math.floor(chunk * 0.6), CFG.UL_MIN_CHUNK);
            }

            return this._trimmedMean(measurements);
        }

        // ── Statistics ─────────────────────────
        /**
         * Trimmed mean — removes warmup + top/bottom 15 % outliers
         * for a robust average that ignores TCP slow-start and flukes.
         */
        _trimmedMean(vals, trim = 0.15) {
            if (vals.length === 0) return 0;
            if (vals.length <= 3)
                return vals.reduce((a, b) => a + b, 0) / vals.length;

            const sorted = [...vals].sort((a, b) => a - b);
            sorted.shift();                                     // drop warmup
            const n   = Math.max(1, Math.floor(sorted.length * trim));
            const mid = sorted.slice(n, sorted.length - n);
            if (mid.length === 0) return sorted.reduce((a, b) => a + b, 0) / sorted.length;
            return mid.reduce((a, b) => a + b, 0) / mid.length;
        }
    }

    // ── Bootstrap ──────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        new SpeedTest();
    });
})();
