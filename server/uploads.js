/**
 * Secure upload handling per spec §15 + Cloudinary storage (persist across redeploys):
 * - server-side MIME + extension validation, size cap
 * - random storage keys (original names never touch disk or Cloudinary)
 * - executables/scripts blocked outright
 * - downloads authorized per-ticket ownership/role (see routes)
 * - Storage backend: Cloudinary when CLOUDINARY_* env vars are set (recommended on
 *   Railway/Vercel where the disk is ephemeral); falls back to local ./uploads when not.
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB per file

const ALLOWED = new Map([
  // images (screenshots, evidence)
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  // documents (receipts, letters)
  ['.pdf', 'application/pdf'],
]);

// ---- Cloudinary (optional) -------------------------------------------------
let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/** Upload a validated temp file to Cloudinary. Returns { storage_key } or null. */
async function cloudinaryUpload(localPath, ext) {
  if (!cloudinary) return null;
  try {
    const r = await cloudinary.uploader.upload(localPath, {
      folder: 'rugipo-tickets',
      resource_type: ext === '.pdf' ? 'raw' : 'image',
      type: 'upload', // private later via signed delivery if needed
    });
    return r.public_id; // storage_key = cloudinary public_id
  } catch (e) {
    console.error('[uploads] cloudinary upload failed, keeping local copy:', e.message);
    return null;
  }
}

/** Delete from Cloudinary (best-effort). */
async function cloudinaryDelete(publicId) {
  if (!cloudinary || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: publicId.endsWith('.pdf') ? 'raw' : 'image' });
  } catch (e) {
    console.error('[uploads] cloudinary delete failed:', e.message);
  }
}

/** Best-effort deliverable URL for staff viewing (signed for PDFs/raw). */
function cloudinaryUrl(publicId) {
  if (!cloudinary || !publicId) return null;
  try {
    return cloudinary.url(publicId, {
      resource_type: publicId.endsWith('.pdf') ? 'raw' : 'image',
      sign_url: publicId.endsWith('.pdf'),
      type: 'upload',
    });
  } catch {
    return null;
  }
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename(_req, file, cb) {
    // Safe storage key: random hex, extension validated separately.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 5 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED.has(ext)) {
      return cb(new Error('File type not allowed. Use images (PNG, JPG, WEBP, GIF) or PDF.'));
    }
    const allowedMimes = [...new Set(ALLOWED.values())];
    if (!allowedMimes.includes(mime)) {
      return cb(new Error('File content type not allowed.'));
    }
    cb(null, true);
  },
});

module.exports = { upload, UPLOAD_DIR, MAX_SIZE, cloudinaryUpload, cloudinaryDelete, cloudinaryUrl };
