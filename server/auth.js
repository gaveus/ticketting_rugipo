/**
 * Authentication: JWT bearer tokens + role middleware.
 * Students NEVER authenticate (no-login flow); staff accounts are provisioned
 * by seed.js or by an Administrator. Roles: staff / senior / admin.
 */
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || '';
const TOKEN_HOURS = 24 * 7; // a week — school staff shouldn't be signed out mid-shift daily

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Put a long random value in server/.env');
  process.exit(1);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    JWT_SECRET,
    { expiresIn: `${TOKEN_HOURS}h` }
  );
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  // Step 1 — verify the token on its own. A failure here is genuinely an
  // auth problem (tampered/expired/malformed) and may end the session.
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }

  // Step 2 — load the user. A failure here is a DATABASE problem (cold
  // connection, timeout). It must NOT answer 401: the client wipes the stored
  // login on any 401, so a transient blip would sign real staff out. Say 503
  // and let them retry.
  try {
    const user = await db.get('SELECT * FROM users WHERE id = ? AND active = 1', payload.sub);
    if (!user) return res.status(401).json({ error: 'Account disabled or missing' });
    req.user = user;
    next();
  } catch (e) {
    console.error('[auth] user lookup failed (database, not auth):', e?.message || e);
    return res.status(503).json({ error: 'The service is busy right now — please try again in a moment.' });
  }
}

function requireStaff(req, res, next) {
  if (!req.user || !['staff', 'senior', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'ICT staff access required' });
  }
  next();
}

/** Senior Engineers + Administrators (spec §27: SENIOR_ENGINEER / ADMIN). */
function requireSenior(req, res, next) {
  if (!req.user || !['senior', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Senior Engineer access required' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
}

module.exports = { signToken, requireAuth, requireStaff, requireSenior, requireAdmin };
