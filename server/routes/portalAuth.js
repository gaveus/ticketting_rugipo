/**
 * /admin portal auth — staff sign-in ONLY.
 * Students NEVER authenticate. There is NO public registration: accounts are
 * created by a Super ICT Support (admin) from the portal
 * (Administration → Accounts). Passwords bcrypt-hashed; lockout on brute force.
 * Login also reports must_change_password so the portal can force profile setup.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { signToken, requireAuth } = require('../auth');
const { cloudinaryUrl } = require('../uploads');

const router = express.Router();

const attempts = new Map(); // simple per-email lockout

/** One canonical user shape everywhere (login, GET /me, POST /me). */
function presentUser(u) {
  return {
    id: u.id, role: u.role, fullName: u.full_name,
    email: u.email, staffNo: u.staff_no, gender: u.gender,
    // Full URL, not the storage key: <img> tags cannot send the Authorization
    // header, so the client must load the photo straight from Cloudinary.
    profileImage: u.profile_image ? (cloudinaryUrl(u.profile_image) || u.profile_image) : null,
    specialty: u.specialty || null,
    mustChangePassword: !!u.must_change_password,
    profileComplete: !!(u.gender && u.phone),
  };
}

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const a = attempts.get(email);
  if (a && a.lockedUntil > Date.now()) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }

  const user = await db.get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    const n = (a?.count || 0) + 1;
    attempts.set(email, { count: n, lockedUntil: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  attempts.delete(email);

  const token = signToken(user);
  res.json({ token, user: presentUser(user) });
});

/** Current profile (for the Settings page). */
router.get('/me', requireAuth, async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!u) return res.status(404).json({ error: 'Account not found' });
  const p = presentUser(u);
  p.createdAt = u.created_at;
  res.json({ user: p });
});

/** Change own password (any signed-in staff). */
router.post('/change-password', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
    return res.status(400).json({ error: 'New password must contain letters and numbers' });
  }
  const u = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!u || !bcrypt.compareSync(current, u.password_hash)) {
    return res.status(401).json({ error: 'Your current password is not correct' });
  }
  if (bcrypt.compareSync(next, u.password_hash)) {
    return res.status(400).json({ error: 'Choose a password you have not used before' });
  }
  await db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    bcrypt.hashSync(next, 12), req.user.id);
  res.json({ ok: true });
});

/** Update own profile details + photo (any signed-in staff). */
router.post('/me', requireAuth, async (req, res) => {
  const phone = req.body?.phone != null ? String(req.body.phone).trim().slice(0, 30) : null;
  const gender = req.body?.gender ? String(req.body.gender).toLowerCase() : null;
  if (gender && !['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: 'Gender must be male or female' });
  }
  await db.run('UPDATE users SET phone = COALESCE(?, phone), gender = COALESCE(?, gender) WHERE id = ?',
    phone, gender, req.user.id);
  const u = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ ok: true, user: presentUser(u) });
});

/** Upload profile photo — stored on Cloudinary like student evidence. */
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { cloudinaryUpload, cloudinaryDelete, UPLOAD_DIR } = require('../uploads');
const meUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Profile photo must be an image (PNG, JPG, WEBP or GIF)'));
  },
});

router.post('/me/photo', requireAuth, meUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo first' });
  try {
    const key = await cloudinaryUpload(req.file.path, path.extname(req.file.filename).toLowerCase());
    fs.unlink(req.file.path, () => {});
    if (!key) return res.status(500).json({ error: 'Could not store the photo right now — try again' });
    await db.run('UPDATE users SET profile_image = ? WHERE id = ?', key, req.user.id);
    res.json({ ok: true, imageUrl: cloudinaryUrl(key) });
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Could not store the photo right now — try again' });
  }
});

/** Remove own profile photo. */
router.delete('/me/photo', requireAuth, async (req, res) => {
  const u = await db.get('SELECT profile_image FROM users WHERE id = ?', req.user.id);
  if (u?.profile_image) {
    cloudinaryDelete(u.profile_image);
    await db.run('UPDATE users SET profile_image = NULL WHERE id = ?', req.user.id);
  }
  res.json({ ok: true });
});

/** Serve own profile photo (redirects to the stored image). */
router.get('/me/photo', requireAuth, async (req, res) => {
  const u = await db.get('SELECT profile_image FROM users WHERE id = ?', req.user.id);
  if (!u?.profile_image) return res.status(404).json({ error: 'No photo on file' });
  const url = cloudinaryUrl(u.profile_image);
  if (url) return res.redirect(url);
  const local = require('path').join(UPLOAD_DIR, u.profile_image);
  if (fs.existsSync(local)) return res.sendFile(local);
  res.status(404).json({ error: 'Photo not found' });
});

/** Upload errors must come back as JSON, never an HTML error page. */
router.use((err, _req, res, _next) => {
  const msg = err?.code === 'LIMIT_FILE_SIZE'
    ? 'That photo is larger than 2 MB — choose a smaller one'
    : (err?.message || 'Upload failed — try again');
  res.status(400).json({ error: msg });
});

module.exports = router;
