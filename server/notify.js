/**
 * Notification layer — all student-facing mail flows through queueEmail().
 * Delivery: Brevo HTTP API (BREVO_API_KEY in server/.env). No SMTP port needed,
 * works from any host including serverless. Every email is ALWAYS written to
 * outbound_emails first (nothing can be lost), then delivered asynchronously:
 *   queued → sent | failed (with error recorded)
 * If the key is missing or Brevo is unreachable, mail stays queued and a later
 * deliverPending() (any login, any new email trigger) retries it.
 */
const nodemailer = require('nodemailer');
const { db } = require('./db');
const { wrapEmail, textToHtml } = require('./emailTemplate');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Two kinds of Brevo credentials are supported, auto-detected by prefix:
 *   xkeysib-…  → HTTP API key  (sent via api.brevo.com)
 *   xsmtpsib-… → SMTP relay key (sent via smtp-relay.brevo.com, username =
 *                the Brevo account email)
 */
function brevoMode() {
  const key = process.env.BREVO_API_KEY || '';
  if (!key || !process.env.BREVO_SENDER_EMAIL) return null;
  if (key.startsWith('xkeysib-')) return 'api';
  if (key.startsWith('xsmtpsib-')) return 'smtp';
  return 'api'; // best guess
}

function brevoConfigured() {
  return !!brevoMode();
}
function smtpConfigured() { return brevoMode() === 'smtp'; } // legacy compat

let smtpTransporter = null;
function getSmtpTransporter() {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.BREVO_SMTP_USER || process.env.BREVO_SENDER_EMAIL,
        pass: process.env.BREVO_API_KEY, // the xsmtpsib- relay key
      },
    });
  }
  return smtpTransporter;
}

/** Send one queued email through whichever Brevo channel the key supports. */
async function sendViaBrevo(m) {
  const senderName = process.env.BREVO_SENDER_NAME || 'RUGIPO ICT Support';
  const mode = brevoMode();
  if (mode === 'smtp') {
    await getSmtpTransporter().sendMail({
      from: `"${senderName}" <${process.env.BREVO_SENDER_EMAIL}>`,
      to: m.to_email,
      subject: m.subject,
      text: m.body,
      ...(m.html ? { html: m.html } : {}),
    });
    return {};
  }
  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: senderName, email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: m.to_email }],
      subject: m.subject,
      textContent: m.body,
      ...(m.html ? { htmlContent: m.html } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${detail.slice(0, 220)}`);
  }
  return res.json().catch(() => ({}));
}

/** Persist first — delivery is always best-effort on top of a stored row. */
async function queueEmail({ ticketId = null, to, subject, body, kind = 'notification' }) {
  if (!to) return;
  // Branded template: the subject doubles as the in-card heading; the plain
  // body becomes readable paragraphs inside the RUGIPO layout.
  const heading = String(subject || 'Update on your complaint')
    .replace(/^\s*[✅⬆📩🎫⭐]*\s*/, '')
    .replace(/^(RUGIPO ICT[::]\s*)/i, '')
    .trim().slice(0, 120);
  const html = wrapEmail({ heading, body: textToHtml(String(body || '')) });
  await db.run(
    `INSERT INTO outbound_emails (ticket_id, to_email, subject, body, html, kind) VALUES (?, ?, ?, ?, ?, ?)`,
    ticketId, String(to).toLowerCase(), subject, body, html, kind);
  deliverPending().catch((e) => console.error('[notify]', e.message));
}

/**
 * Deliver everything still queued (oldest first, bounded per call).
 * Safe to call concurrently — each row is marked 'sending' before the API call
 * so two callers never send the same email twice.
 */
let delivering = false;
async function deliverPending() {
  if (!brevoConfigured() || delivering) return;
  delivering = true;
  try {
    for (;;) {
      const batch = await db.all(
        `SELECT * FROM outbound_emails WHERE status = 'queued' ORDER BY id LIMIT 20`);
      if (batch.length === 0) break;
      for (const m of batch) {
        const claimed = await db.run(
          `UPDATE outbound_emails SET status='sending' WHERE id=? AND status='queued'`, m.id);
        if (!claimed.changes) continue; // someone else took it
        try {
          await sendViaBrevo(m);
          await db.run(`UPDATE outbound_emails SET status='sent', sent_at=now() WHERE id=?`, m.id);
        } catch (e) {
          await db.run(`UPDATE outbound_emails SET status='failed', error=? WHERE id=?`,
            String(e.message).slice(0, 400), m.id);
        }
      }
    }
  } finally {
    delivering = false;
  }
}

/** Retry failed mail (admin action). */
async function retryFailed() {
  await db.run(`UPDATE outbound_emails SET status='queued' WHERE status='failed'`);
  return deliverPending();
}

module.exports = { queueEmail, deliverPending, retryFailed, brevoConfigured, smtpConfigured };
