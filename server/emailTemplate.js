/**
 * RUGIPO email design system — one branded wrapper for every notification.
 * Email-safe: table layout, inline styles, system fonts, no external CSS.
 * Palette matches the portal (deep green + gold).
 */

const GREEN_DEEP = '#07421f';
const GREEN = '#0f7a3d';
const GOLD = '#f7c600';
const INK = '#22293a';
const MUTED = '#5a6478';
const LINE = '#e3e8f1';
const BG = '#f2f6f3';

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Wrap content in the branded layout.
 * @param {object} o
 * @param {string} o.heading    Big title inside the card
 * @param {string} o.body       HTML content (already escaped where needed)
 * @param {string} [o.note]     Small grey footnote under the body
 * @param {{label:string, url:string}} [o.cta]
 */
function wrapEmail({ heading, body, note, cta }) {
  const year = new Date().getFullYear();
  const base = process.env.PUBLIC_BASE_URL || '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;font-size:1px;color:${BG};max-height:0;overflow:hidden;">RUGIPO ICT Support — update on your complaint</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 8px 14px;" align="center">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:700;color:${GREEN_DEEP};">
        RUFUS GIWA POLYTECHNIC, OWO</div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};letter-spacing:.08em;text-transform:uppercase;margin-top:2px;">
        ICT Support Ticketing</div>
    </td></tr>
    <tr><td style="background:#ffffff;border-radius:14px;border:1px solid ${LINE};border-top:5px solid ${GOLD};padding:28px 26px;">
      <h1 style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.3;color:${INK};">
        ${heading}</h1>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.65;color:${INK};">
        ${body}
      </div>
      ${cta ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr><td align="center">
        <a href="${cta.url}" style="display:inline-block;background:${GOLD};color:${GREEN_DEEP};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:13px 30px;border-radius:9px;">${escapeHtml(cta.label)}</a>
      </td></tr></table>` : ''}
      ${note ? `<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};">${note}</p>` : ''}
    </td></tr>
    <tr><td style="padding:18px 10px 4px;" align="center">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};">
        Rufus Giwa Polytechnic, Owo · ICT Support Unit<br>
        This message relates to a complaint you logged on the ICT Support portal.<br>
        <a href="${base}/track" style="color:${GREEN};">Track a complaint</a> · <a href="${base}/" style="color:${GREEN};">Log a new complaint</a>
      </p>
      <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9aa3b2;">
        © ${year} Rufus Giwa Polytechnic, Owo</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Turn plain-text body (the content routes compose) into readable branded
 * paragraphs. Lines like "Tracking ID: RGP-…" or "ICT note: …" become
 * highlighted key/value rows so the important facts jump out — students
 * should never have to hunt for their ID or what ICT actually did.
 */
const KEY_RE = /^(Tracking ID|What it was about|What ICT did|Ticket|Service|Student|Escalated by|Reason|Role|Staff ID|Sign in here|Email|Temporary password|Amount|Payment was for|When|Our reply|What you told us)\s*:/i;

function textToHtml(text = '') {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => {
      // A whole paragraph that is one key-value line → highlighted fact box.
      const m = p.match(KEY_RE);
      if (m && !p.includes('\n')) {
        const idx = p.indexOf(':');
        const key = p.slice(0, idx);
        const val = p.slice(idx + 1).trim();
        const isNote = /^ICT note$/i.test(key);
        if (isNote) {
          // The resolution note is the headline fact — gold callout, bold.
          return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 16px;"><tr><td style="background:#fdf6dd;border-left:4px solid ${GOLD};border-radius:8px;padding:12px 14px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">What ICT did</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1.55;color:${GREEN_DEEP};">${val}</div>
          </td></tr></table>`;
        }
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0;"><tr>
          <td style="font-family:Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:700;color:${MUTED};padding:5px 12px 5px 0;white-space:nowrap;vertical-align:top;">${key}:</td>
          <td style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;font-weight:700;color:${INK};padding:5px 0;">${val}</td>
        </tr></table>`;
      }
      return `<p style="margin:0 0 12px;">${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

/**
 * Build a complete branded email from simple parts.
 * Returns { subject, html, text } ready for the Brevo API.
 */
function buildEmail({ heading, paragraphs = [], cta, note, fallbackText = '' }) {
  const bodyHtml = textToHtml(paragraphs.join('\n\n'));
  return {
    html: wrapEmail({ heading, body: bodyHtml, note, cta }),
    text: fallbackText || paragraphs.join('\n\n'),
  };
}

module.exports = { buildEmail, wrapEmail, escapeHtml, textToHtml };
