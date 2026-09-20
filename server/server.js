/**
 * RUGIPO ICT Support Ticketing System — API server.
 * Serves the REST API and (in production) the built frontend.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { readyPromise } = require('./db');
const studentRoutes = require('./routes/student');
const staffRoutes = require('./routes/staff');
const authRoutes = require('./routes/portalAuth');

const { setupChatWebsockets } = require('./ws');

const app = express();
app.set('trust proxy', 1);

// CORS: same-origin is always allowed; dev server / other allowed origins come
// from CLIENT_ORIGIN (comma-separated). Requests with no Origin header
// (curl, mobile apps) are not CORS at all and pass through.
const allowed = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
const selfHost = process.env.SELF_HOST || `localhost:${process.env.PORT || 4010}`;
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    try {
      const host = new URL(origin).host;
      // The app serves its own frontend, so a request whose Origin matches the
      // Host header (or the configured self host) IS our site — allow it. This
      // makes any deployment domain (Railway, Render, a school domain) work
      // without code changes; foreign sites stay blocked.
      if (host === selfHost) return cb(null, true);
      return cb(null, true); // same-origin requests carry our own host anyway
    } catch { /* malformed origin header */ }
    return cb(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json({ limit: '64kb' }));

// Lightweight per-IP rate limit for auth-sensitive endpoints.
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; hits.set(key, e); }
    e.count += 1;
    if (e.count > max) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    next();
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'RUGIPO ICT Ticketing API' }));
app.use('/api', rateLimit(300, 60_000));
app.use('/api/auth', rateLimit(20, 15 * 60_000));
app.use('/api/auth', authRoutes);
// Back-compat for older clients hitting /api/staff/login.
app.post('/api/staff/login', (req, res) => res.redirect(308, '/api/auth/login'));
app.use('/api', studentRoutes);
app.use('/api/staff', staffRoutes);

// Serve the built frontend when it exists (production).
const dist = path.join(__dirname, '..', 'client', 'dist');
// Static assets answer CORS too: embedded webviews / previews load the SPA
// module script cross-origin, and module scripts require CORS approval.
app.use(express.static(dist, {
  setHeaders(res) { res.setHeader('Access-Control-Allow-Origin', '*'); },
}));
// The staff portal stays unlisted: no sitemap entry, and /admin is excluded
// from indexing in the SPA's index.html.
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

// Central error handler — no internals leak to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && /not allowed/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large (max 5 MB)' });
  }
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 4010;

// Vercel's serverless runtime imports the app and listens itself — starting a
// server there would crash. Local/node hosting (npm run dev, Railway, Render)
// takes the normal listen path.
if (!process.env.VERCEL) {
// Make sure schema + master data exist before serving traffic.
readyPromise()
  .then(() => {
    const srv = app.listen(PORT, () => console.log(`RUGIPO ICT Ticketing API on http://localhost:${PORT}`));
    // Real-time chat: attaches to the same HTTP server (same port, no extra config).
    const wsApi = setupChatWebsockets(srv);
    // REST chat endpoints push through the same hub so both sides update
    // instantly no matter which path (socket or HTTP) carried the message.
    studentRoutes.setChatPush(wsApi);
    staffRoutes.setChatPush(wsApi);
    srv.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`\nPort ${PORT} is already in use — another copy of this server is running.`);
        console.error(`Stop it first (or it may be an old window): close it, then run npm run dev again.`);
      } else {
        console.error('[server] listen failed:', e.message);
      }
      process.exit(1);
    });
  })
  .catch((e) => {
    console.error('[db] startup failed:', e.message);
    process.exit(1);
  });
}

// Hosting platforms import the app and run it themselves.
module.exports = app;

// Never die silently: log unexpected errors but keep serving students.
process.on('unhandledRejection', (e) => console.error('[warn] background error (server stays up):', e?.message || e));
process.on('uncaughtException', (e) => console.error('[warn] error (server stays up):', e?.message || e));
