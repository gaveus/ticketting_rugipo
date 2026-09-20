/**
 * Desk routing + scoping.
 *
 * A complaint belongs to the PAYMENT desk (Mr Sam + Mr Emmanuel) when it is
 * about the money itself: debited-but-not-reflecting, expired payment links,
 * failed charges — AND receipt complaints where the student attached their
 * payment receipt / debit evidence (showing HOW the debit happened is a money
 * question). Receipt problems WITHOUT evidence (the portal simply failed to
 * generate the file) are a portal function → PORTAL desk (Mr Tony + Mr Samson).
 *
 * The desk is computed and stored on the ticket at creation time and again
 * whenever a student adds evidence, so every list/count/report can filter by
 * `tickets.desk` with a plain index-friendly comparison.
 */
const { db } = require('./db');

/** Recompute + persist which desk owns this ticket. Returns 'payment' | 'portal'. */
async function computeDesk(ticketId) {
  const t = await db.get(`
    SELECT i.requires_payment_details AS pays, c.name AS category,
           EXISTS (SELECT 1 FROM ticket_attachments a WHERE a.ticket_id = t.id AND a.uploaded_by = 'student') AS evidence
    FROM tickets t
    JOIN ticket_issue_types i ON i.id = t.issue_type_id
    JOIN ticket_categories c ON c.id = t.category_id
    WHERE t.id = ?`, ticketId);
  if (!t) return 'portal';
  const desk = (Number(t.pays) === 1 || (t.category === 'Receipt' && Number(t.evidence) === 1))
    ? 'payment' : 'portal';
  await db.run('UPDATE tickets SET desk = ? WHERE id = ?', desk, ticketId);
  return desk;
}

/**
 * WHERE fragment limiting a senior to their own desk (table must expose `desk`).
 * Always returns a valid condition — unscoped users get '1=1' — so callers can
 * safely interpolate it after AND/WHERE without empty-condition syntax errors.
 */
function deskScope(user) {
  if (!user || user.role !== 'senior' || !user.specialty) return { sql: '1=1', params: [] };
  return user.specialty === 'payment'
    ? { sql: "COALESCE(desk,'portal') = 'payment'", params: [] }
    : { sql: "COALESCE(desk,'portal') <> 'payment'", params: [] };
}

module.exports = { computeDesk, deskScope };
