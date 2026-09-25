/**
 * Staff / Senior Engineer / Admin API.
 *  roles: staff = ICT Support · senior = Senior Engineer · admin = Administrator
 *
 * Spec compliance:
 *  - Escalation requires a reason; identity comes from the authenticated user
 *    (never the frontend) and is stored in the escalations table.
 *  - Only senior/admin can move a ticket out of 'escalated' (RBAC §27).
 *  - Resolving is backend-authorized and auto-notifies the student's saved email.
 *  - Admin can manage the faculty/department master data and the ICT service
 *    catalogue — no frontend code changes needed to edit them (spec §12/§32).
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireStaff, requireSenior, requireAdmin } = require('../auth');
const { deskScope } = require('../desk');
const { queueEmail } = require('../notify');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Live-chat push helpers from the websocket hub (see server.js). REST sends,
// replies and closes call these so the student's chat (and other officers'
// tabs) update instantly — no refresh, no polling wait.
let wsApi = {};
function setChatPush(api) { wsApi = api || {}; }
const realtime = require('../realtime');
router.setChatPush = setChatPush;
router.use(requireAuth, requireStaff);

const STATUSES = ['open', 'assigned', 'in_progress', 'waiting_student', 'escalated', 'resolved', 'closed', 'rejected'];
const TRANSITIONS = {
  open: ['assigned', 'in_progress', 'escalated', 'resolved', 'rejected'],
  assigned: ['in_progress', 'waiting_student', 'escalated', 'resolved', 'rejected', 'open'],
  in_progress: ['waiting_student', 'escalated', 'resolved', 'rejected', 'assigned'],
  waiting_student: ['in_progress', 'escalated', 'resolved', 'rejected'],
  escalated: ['in_progress', 'resolved', 'rejected'],       // senior engineers work escalated tickets
  resolved: ['closed', 'in_progress', 'open'],
  closed: ['open'],
  rejected: ['open'],
};

async function audit(req, action, entityId, metadata) {
  await db.run(`INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata)
              VALUES (?, ?, ?, 'ticket', ?, ?)`, req.user.id, req.user.full_name, action, entityId, metadata ? JSON.stringify(metadata) : null);
}

function notifyStudent(t, subject, body, kind) {
  queueEmail({ ticketId: t.id, to: t.email, subject, body, kind });
}

/**
 * Desk guard: a Senior Engineer may only open/work complaints on their own
 * desk (payment seniors → payment complaints, portal seniors → the rest).
 * ICT Support staff and Super ICT Support pass untouched.
 */
async function guardDesk(req, res, t) {
  if (req.user.role !== 'senior' || !req.user.specialty) return true;
  const desk = await require('../desk').computeDesk(t.id); // also heals missing desk values
  if (desk === req.user.specialty) return true;
  res.status(403).json({
    error: `This complaint belongs to the ${desk === 'payment' ? 'Payment' : 'Portal'} desk — it is outside your assignment.`,
  });
  return false;
}

/**
 * Administration guard: only a Super ICT Support may perform administration
 * actions (accounts, master data, announcements). First-line ICT Support can
 * OPEN the admin pages read-only but any write is rejected here.
 */
function requireSuper(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only Super ICT Support can make administration changes — you have view access only.' });
  }
  next();
}

/**
 * Which student questions a desk should see. Matched against the question's
 * subject in plain words a student would actually write — "payment", money,
 * receipt or Appiawave for the payment desk; anything about the portal,
 * results, registration, email or admission for the portal desk. A subject
 * with none of these words stays with ICT Support.
 */
function specialtyNeedles(specialty) {
  const words = specialty === 'payment'
    ? ['payment', 'paid', 'pay%', 'money', 'debit', 'receipt', 'appia%', 'transfer', 'refund']
    : ['portal', 'login', 'log in', 'sign in', 'password', 'result%', 'course', 'registr%',
       'admission', 'cbt', 'exam%', 'print', 'email', 'account', 'school fees', 'profile', 'student'];
  return words.map((w) => `%${w}%`);
}

/**
 * A complaint's desk. 'payment' = anything about the money itself: debited
 * but not reflecting, expired payment links, failed charges — AND receipt
 * complaints that carry payment/debit evidence (a student showing HOW they
 * were debited proves a payment problem, so Mr Sam and Mr Emmanuel handle it).
 * Receipt problems WITHOUT payment/debit details (portal simply failed to
 * generate the file) are a portal function → portal desk (Tony & Samson).
 * Drives which Senior Engineer pair receives the escalation.
 */
async function ticketSpecialty(ticketId) {
  const t = await db.get(`
    SELECT i.requires_payment_details AS pays
    FROM tickets t
    JOIN ticket_issue_types i ON i.id = t.issue_type_id
    WHERE t.id = ?`, ticketId);
  if (!t) return 'portal';
  // The student supplied payment/debit details → the money is in question → payment desk.
  return Number(t.pays) === 1 ? 'payment' : 'portal';
}

/* ----------------------------- dashboard ----------------------------- */

router.get('/stats', async (req, res) => {
  const scope = deskScope(req.user);
  const count = async (where, ...params) => {
    const cond = where ? where.replace(/^WHERE\s+/i, '') : '';
    return (await db.get(
      `SELECT COUNT(*)::int AS n FROM tickets t WHERE 1=1 AND ${scope.sql}${cond ? ' AND ' + cond : ''}`,
      ...scope.params, ...params)).n;
  };
  const mine = req.query.scope === 'mine' ? 'AND t.assigned_staff_id = ?' : '';
  const mineParams = req.query.scope === 'mine' ? [req.user.id] : [];
  const [open, assigned, inProgress, waitingStudent, escalated, resolvedToday, closed, thisMonth, myTickets] = await Promise.all([
    count(`WHERE status = 'open'`),
    count(`WHERE status = 'assigned'`),
    count(`WHERE status = 'in_progress'`),
    count(`WHERE status = 'waiting_student'`),
    count(`WHERE status = 'escalated'`),
    count(`WHERE status IN ('resolved','closed') AND resolved_at >= date_trunc('day', now())`),
    count(`WHERE status = 'closed'`),
    count(`WHERE created_at >= date_trunc('month', now())`),
    count(`WHERE assigned_staff_id = ? AND status NOT IN ('resolved','closed','rejected')`, req.user.id),
  ]);
  const stats = { open, assigned, inProgress, waitingStudent, escalated, resolvedToday, closed, thisMonth, myTickets };
  const recent = await db.all(`SELECT t.id, t.ticket_number, t.status, t.priority, t.created_at, t.student_name, t.matric_no, t.department,
            c.name AS category, i.name AS issue
     FROM tickets t
     JOIN ticket_categories c ON c.id = t.category_id
     JOIN ticket_issue_types i ON i.id = t.issue_type_id
     WHERE 1=1 AND ${scope.sql}
     ORDER BY t.created_at DESC LIMIT 8`, ...scope.params);
  const topIssues = await db.all(`SELECT i.name AS issue, c.name AS category, COUNT(*)::int AS n
     FROM tickets t JOIN ticket_issue_types i ON i.id = t.issue_type_id
     JOIN ticket_categories c ON c.id = t.category_id
     WHERE 1=1 AND ${scope.sql}
     GROUP BY i.id, i.name, c.name ORDER BY n DESC LIMIT 6`, ...scope.params);
  const subscribers = (await db.get(`SELECT COUNT(*)::int AS n FROM subscribers WHERE unsubscribed_at IS NULL`)).n;
  const queuedEmails = (await db.get(`SELECT COUNT(*)::int AS n FROM outbound_emails WHERE status IN ('queued','pending_credentials','sending')`)).n;
  // Live master-data counts — proof on the dashboard that this IS the Aiven DB.
  const dataCounts = await db.get(`SELECT
     (SELECT COUNT(*)::int FROM tickets) AS tickets,
     (SELECT COUNT(*)::int FROM students) AS students,
     (SELECT COUNT(*)::int FROM faculties) AS faculties,
     (SELECT COUNT(*)::int FROM departments) AS departments,
     (SELECT COUNT(*)::int FROM ticket_categories) AS services,
     (SELECT COUNT(*)::int FROM audit_logs) AS audit_events`);
  res.json({ stats, recent, topIssues, subscribers, queuedEmails, dataCounts });
});

/* --------------------- messages from students (inbox) --------------------- */

/** Questions students sent through the contact page. Staff (all roles) can read and answer. */
router.get('/inbox', async (req, res) => {
  // Search + filter so a thousand-student inbox stays usable: find any
  // student by name, email, matric number, phone or subject instantly.
  const q = String(req.query.q || '').trim().slice(0, 120);
  const filter = String(req.query.filter || 'all'); // all | waiting | answered | closed
  const like = q ? `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%` : null;
  const where = [];
  const params = [];
  // Seniors see only the questions their desk would handle — ICT Support sees
  // everything, because first-line is the doorway for every student.
  const seniorOnly = req.user?.role === 'senior' && req.user.specialty;
  if (seniorOnly) {
    const needles = specialtyNeedles(seniorOnly);
    where.push(`(${needles.map(() => 'LOWER(cm.subject) LIKE ?').join(' OR ')})`);
    params.push(...needles);
  }
  if (like) {
    where.push(`(cm.sender_name ILIKE ? OR cm.email ILIKE ? OR COALESCE(cm.matric_no,'') ILIKE ?
       OR COALESCE(cm.phone,'') ILIKE ? OR cm.subject ILIKE ? OR cm.message ILIKE ?)`);
    params.push(like, like, like, like, like, like);
  }
  if (filter === 'waiting') where.push(`cm.closed_at IS NULL AND (cm.status = 'new'
     OR EXISTS (SELECT 1 FROM chat_messages c WHERE c.message_id = cm.id AND c.sender = 'student'
        AND c.created_at > COALESCE(cm.staff_seen_at, to_timestamp(0))))`);
  if (filter === 'answered') where.push(`cm.closed_at IS NULL AND cm.status = 'answered'`);
  if (filter === 'closed') where.push(`cm.closed_at IS NOT NULL`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await db.all(`SELECT cm.*,
      (SELECT sender FROM chat_messages c WHERE c.message_id = cm.id ORDER BY c.id DESC LIMIT 1) AS last_sender,
      (SELECT MAX(created_at) FROM chat_messages c WHERE c.message_id = cm.id) AS last_msg_at
    FROM contact_messages cm ${whereSql}
    ORDER BY (cm.status = 'new') DESC, (cm.closed_at IS NOT NULL),
      COALESCE((SELECT MAX(created_at) FROM chat_messages c WHERE c.message_id = cm.id), cm.created_at) DESC
    LIMIT 200`, ...params);
  // Unread = never answered, or the student spoke last and no officer has seen it since.
  const unread = rows.filter((r) => !r.closed_at &&
    (r.status === 'new' || (r.last_sender === 'student' && (!r.staff_seen_at || (r.last_msg_at && new Date(r.last_msg_at) > new Date(r.staff_seen_at)))))).length;
  res.json({ messages: rows, unread });
});

/** Answer a student's question — the reply is emailed instantly with their private chat link. */
router.post('/inbox/:id/reply', async (req, res) => {
  const m = await db.get('SELECT * FROM contact_messages WHERE id = ?', req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.closed_at) return res.status(410).json({ error: 'This conversation is closed' });
  const reply = String(req.body?.reply || '').trim();
  if (reply.length < 5) return res.status(400).json({ error: 'Write the reply first (at least 5 characters)' });
  await db.run(`UPDATE contact_messages SET staff_reply = ?, replied_by = ?, replied_by_name = ?, replied_at = now(), status = 'answered',
     staff_seen_at = now() WHERE id = ?`, reply.slice(0, 4000), req.user.id, req.user.full_name, m.id);
  // The reply also enters the live conversation thread — and pushes instantly
  // to the student's open chat window.
  await db.run(`INSERT INTO chat_messages (message_id, sender, sender_name, body) VALUES (?, 'staff', ?, ?)`,
    m.id, req.user.full_name, reply.slice(0, 4000));
  wsApi.fanoutStaffSnapshot?.(m.id);
  wsApi.fanoutStudentSnapshot?.(m.chat_token);
  realtime.chatRefresh(m.id);
  // The live chat IS the reply channel — it pushes to the student's open
  // window instantly. Email only when ICT explicitly chooses "Email it".
  if (req.body?.emailIt) {
    queueEmail({
      to: m.email,
      kind: 'contact-reply',
      subject: `Re: ${m.subject} — RUGIPO ICT Support`,
      body: `Hello ${m.sender_name},\n\nYou wrote to us:\n"${m.message.slice(0, 300)}"\n\nOur reply:\n${reply}\n\nTo keep talking with us in a live chat, open your conversation here:\n${process.env.PUBLIC_BASE_URL || ''}/chat/${m.chat_token || ''}\n(keep this link — it is your private door to the conversation)\n\nIf this did not fully solve it, log a complaint from the ICT Support page — you'll get a Tracking ID and we'll see it through with you.\n\n— ${req.user.full_name}, RUGIPO ICT Support`,
    });
  }
  audit(req, 'inbox.reply', m.id, { subject: m.subject, emailed: !!req.body?.emailIt });
  res.json({ ok: true });
});

/* ------------------- live chat on a student's question ------------------- */

/** The conversation thread (staff side — any officer). Marks it as seen. */
router.get('/inbox/:id/chat', async (req, res) => {
  const m = await db.get('SELECT * FROM contact_messages WHERE id = ?', req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  await db.run('UPDATE contact_messages SET staff_seen_at = now() WHERE id = ?', m.id);
  const messages = m.closed_at ? [] : await db.all(
    'SELECT id, sender, sender_name, body, created_at FROM chat_messages WHERE message_id = ? ORDER BY created_at, id', m.id);
  const typingWindow = (ts) => (ts && (Date.now() - new Date(ts).getTime()) < 8000);
  res.json({
    id: m.id, subject: m.subject, studentName: m.sender_name, email: m.email,
    status: m.status, closed: !!m.closed_at, messages,
    // Messenger-style presence: is the student typing right now, and did they
    // open the conversation since our last reply?
    studentTyping: !m.closed_at && typingWindow(m.student_typing_at),
    studentLastOpenedAt: m.student_opened_at || null,
  });
});

/** Officer is typing — the student's chat shows "ICT Support is typing…". */
router.post('/inbox/:id/typing', async (req, res) => {
  await db.run('UPDATE contact_messages SET staff_typing_at = now() WHERE id = ?', req.params.id);
  realtime.chatTyping(Number(req.params.id), 'staff');
  res.json({ ok: true });
});

/** Officer sends a chat message into the thread. */
router.post('/inbox/:id/chat', async (req, res) => {
  const m = await db.get('SELECT * FROM contact_messages WHERE id = ?', req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.closed_at) return res.status(410).json({ error: 'This conversation is closed' });
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (body.length < 2) return res.status(400).json({ error: 'Type a message first' });
  await db.run(`INSERT INTO chat_messages (message_id, sender, sender_name, body) VALUES (?, 'staff', ?, ?)`,
    m.id, req.user.full_name, body);
  await db.run(`UPDATE contact_messages SET replied_by = ?, replied_by_name = ?, replied_at = now(), status = 'answered',
     staff_seen_at = now() WHERE id = ? AND replied_by IS NULL`, req.user.id, req.user.full_name, m.id);
  // Push to every viewer: the student sees the reply instantly, and any other
  // officer watching the same thread stays in sync (also covers the sender's
  // own tab when the websocket hiccups).
  wsApi.fanoutStaffSnapshot?.(m.id);
  wsApi.fanoutStudentSnapshot?.(m.chat_token);
  realtime.chatRefresh(m.id);
  res.json({ ok: true });
});

/** Officer closes the conversation — the entire history is deleted. */
router.post('/inbox/:id/close', async (req, res) => {
  const m = await db.get('SELECT id FROM contact_messages WHERE id = ?', req.params.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  await db.run('DELETE FROM chat_messages WHERE message_id = ?', m.id);
  await db.run(`UPDATE contact_messages SET closed_at = now(), status = 'closed',
     message = '(conversation closed)', staff_reply = NULL WHERE id = ?`, m.id);
  // Flip every open chat window (student's included) to "closed" instantly.
  wsApi.broadcastStudentClosed?.(m.chat_token);
  wsApi.broadcastStaffClosed?.(m.id);
  realtime.chatClosed(m.id);
  realtime.chatRefresh(m.id);
  realtime.inboxBadge();
  audit(req, 'inbox.close', m.id, { note: 'conversation closed' });
  res.json({ ok: true });
});

/** Sidebar badges — light query for the shell's count pills. */
router.get('/badges', async (req, res) => {
  const scope = deskScope(req.user); // seniors count only their own desk
  // A senior's "new questions" badge counts only what their desk would handle
  // — a payment question never lights up for a portal engineer.
  const seniorOnly = req.user?.role === 'senior' && req.user.specialty;
  const seniorWhere = seniorOnly
    ? `(${specialtyNeedles(seniorOnly).map(() => 'LOWER(subject) LIKE ?').join(' OR ')})`
    : '';
  const seniorParams = seniorOnly ? specialtyNeedles(seniorOnly) : [];
  const [openRow, escRow, unreadRow, waitingRow] = await Promise.all([
    db.get(`SELECT COUNT(*)::int AS n FROM tickets WHERE status = 'open' AND ${scope.sql}`, ...scope.params),
    db.get(`SELECT COUNT(*)::int AS n FROM tickets WHERE status = 'escalated' AND ${scope.sql}`, ...scope.params),
    db.get(`SELECT COUNT(*)::int AS n FROM contact_messages WHERE closed_at IS NULL AND status = 'new'
       ${seniorOnly ? `AND (${seniorWhere})` : ''}`, ...seniorParams),
    db.get(`SELECT COUNT(*)::int AS n FROM tickets WHERE status = 'in_progress' AND assigned_staff_id = ?`, req.user.id),
  ]);
  res.json({ open: openRow.n, escalated: escRow.n, unread: unreadRow.n, mine: waitingRow.n });
});

/**
 * Everything the Overview screen needs in one call — real numbers only.
 * The trend series respects ?day= ?month= ?year= ?from=&to= — any day, month,
 * year or custom range (defaults to the last 7 days) — and the trend deltas
 * compare the chosen window with the equal-length window before it.
 *//** Safe query — one flaky database call must never take the whole dashboard down. */
async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { console.error('[overview] section failed:', e?.message || e); return fallback; }
}

router.get('/overview', async (req, res) => {
  const scope = deskScope(req.user); // seniors see only their desk's numbers
  const stage = (st) => db.get(`SELECT COUNT(*)::int AS n FROM tickets WHERE status = ? AND ${scope.sql}`, st, ...scope.params);
  const [open, inProgress, waiting, escalated, resolvedToday, unassigned] = await Promise.all([
    stage('open'), stage('in_progress'), stage('waiting_student'), stage('escalated'),
    safe(() => db.get(`SELECT COUNT(*)::int AS n FROM tickets WHERE status IN ('resolved','closed')
       AND updated_at >= date_trunc('day', now()) AND ${scope.sql}`, ...scope.params), { n: 0 }),
    safe(() => db.get(`SELECT COUNT(*)::int AS n FROM tickets WHERE status = 'open' AND assigned_staff_id IS NULL AND ${scope.sql}`, ...scope.params), { n: 0 }),
  ].map((p) => p.catch((e) => { console.error('[overview] count failed:', e?.message || e); return { n: 0 }; })));

  // Which window are we charting? Same grammar as the Reports page.
  const q = req.query || {};
  // A senior's "questions waiting" number counts only what their desk would
  // handle — the money questions belong to the payment pair alone.
  const seniorOnly = req.user?.role === 'senior' && req.user.specialty;
  const seniorOnlyWhere = seniorOnly
    ? specialtyNeedles(seniorOnly).map(() => 'LOWER(subject) LIKE ?').join(' OR ')
    : '';
  const seniorOnlyParams = seniorOnly ? specialtyNeedles(seniorOnly) : [];
  let label = 'Last 7 days';
  let seriesWhere;
  let grain = 'day'; // day | hour | month
  const sp = [];
  if (q.day) {
    sp.push(q.day, q.day); seriesWhere = `created_at >= ?::date AND created_at < (?::date + interval '1 day')`; label = `Day: ${q.day}`; grain = 'hour';
  } else if (q.month) {
    sp.push(q.month + '-01', q.month + '-01'); seriesWhere = `created_at >= ?::date AND created_at < (?::date + interval '1 month')`; label = `Month: ${q.month}`;
  } else if (q.year) {
    sp.push(q.year + '-01-01', q.year + '-01-01'); seriesWhere = `created_at >= ?::date AND created_at < (?::date + interval '1 year')`; label = `Year: ${q.year}`; grain = 'month';
  } else if (q.from && q.to) {
    sp.push(q.from, q.to); seriesWhere = `created_at >= ?::date AND created_at < (?::date + interval '1 day')`; label = `From ${q.from} to ${q.to}`;
  } else if (q.span === '30') {
    seriesWhere = `created_at >= now() - interval '29 days'`; label = 'Last 30 days';
  } else {
    seriesWhere = `created_at >= date_trunc('day', now()) - interval '6 days'`;
  }

  // Series buckets straight from SQL — one row per hour/day/month in range.
  const bucket = grain === 'hour' ? "to_char(date_trunc('hour', created_at), 'HH24:00')"
    : grain === 'month' ? "to_char(date_trunc('month', created_at), 'Mon YYYY')"
    : "to_char(date_trunc('day', created_at), 'DD Mon')";
  const bucketOrder = grain === 'hour' ? "date_trunc('hour', created_at)"
    : grain === 'month' ? "date_trunc('month', created_at)"
    : "date_trunc('day', created_at)";
  const createdRows = await safe(() => db.all(`SELECT ${bucket} AS bucket, COUNT(*)::int AS n FROM tickets
     WHERE ${seriesWhere} AND ${scope.sql} GROUP BY 1, ${bucketOrder} ORDER BY ${bucketOrder}`, ...scope.params, ...sp), []);
  const resolvedRows = await safe(() => db.all(`SELECT ${bucket} AS bucket, COUNT(*)::int AS n FROM tickets
     WHERE status IN ('resolved','closed') AND resolved_at IS NOT NULL AND ${seriesWhere} AND ${scope.sql}
     GROUP BY 1, ${bucketOrder} ORDER BY ${bucketOrder}`, ...scope.params, ...sp), []);
  const escalatedRows = await safe(() => db.all(`SELECT ${bucket} AS bucket, COUNT(*)::int AS n FROM ticket_status_history h
     WHERE h.new_status = 'escalated' AND ${seriesWhere}
     GROUP BY 1, ${bucketOrder.replace(/created_at/g, 'h.created_at')} ORDER BY ${bucketOrder.replace(/created_at/g, 'h.created_at')}`, ...sp), []);

  // Merge the three measures into one series (fill missing buckets with 0).
  const buckets = [];
  const seen = new Set();
  for (const r of [...createdRows, ...resolvedRows, ...escalatedRows]) {
    if (!seen.has(r.bucket)) { seen.add(r.bucket); buckets.push(r.bucket); }
  }
  buckets.sort((a, b) => {
    const ai = createdRows.findIndex((r) => r.bucket === a); const bi = createdRows.findIndex((r) => r.bucket === b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  const map = (rows) => Object.fromEntries(rows.map((r) => [r.bucket, r.n]));
  const cm = map(createdRows), rm = map(resolvedRows), em = map(escalatedRows);
  const days = buckets.map((b) => ({
    day: b, created: cm[b] || 0, resolved: rm[b] || 0, escalated: em[b] || 0,
  }));

  // Trend deltas: chosen window vs the equal-length window immediately before it.
  async function windowTotals(where, params) {
    const [c, r, e] = await Promise.all([
      db.get(`SELECT COUNT(*)::int AS n FROM tickets WHERE ${where} AND ${scope.sql}`, ...scope.params, ...params),
      db.get(`SELECT COUNT(*)::int AS n FROM tickets WHERE status IN ('resolved','closed') AND resolved_at IS NOT NULL AND ${where} AND ${scope.sql}`, ...scope.params, ...params),
      db.get(`SELECT COUNT(*)::int AS n FROM ticket_status_history WHERE new_status = 'escalated' AND ${where}`, ...params),
    ]);
    return { created: c.n, resolved: r.n, escalated: e.n };
  }
  async function prevTotals() {
    const p = [];
    if (q.day) { p.push(q.day, q.day); return windowTotals("created_at >= (?::date - interval '1 day') AND created_at < ?::date", p); }
    if (q.month) { p.push(q.month + '-01', q.month + '-01'); return windowTotals("created_at >= ((?::date - interval '1 month')) AND created_at < ?::date", p); }
    if (q.year) { p.push(q.year + '-01-01', q.year + '-01-01'); return windowTotals("created_at >= ((?::date - interval '1 year')) AND created_at < ?::date", p); }
    if (q.from && q.to) {
      const from = new Date(q.from); const to = new Date(q.to);
      const span = Math.max(1, Math.round((to - from) / 86400_000) + 1); // days, inclusive
      const before = new Date(from.getTime() - span * 86400_000);
      const iso = (d) => d.toISOString().slice(0, 10);
      return windowTotals('created_at >= ?::date AND created_at < ?::date', [iso(before), iso(from)]);
    }
    if (q.span === '30') return windowTotals("created_at >= now() - interval '59 days' AND created_at < now() - interval '29 days'", []);
    return windowTotals("created_at >= date_trunc('day', now()) - interval '13 days' AND created_at < date_trunc('day', now()) - interval '6 days'", []);
  }
  let prev = { created: 0, resolved: 0, escalated: 0 };
  try { prev = await prevTotals(); } catch { /* keep zeros */ }
  const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : (now > 0 ? 100 : 0));
  const sum = (k) => days.reduce((a, d) => a + (d[k] || 0), 0);
  const trends = {
    created: pct(sum('created'), prev.created),
    resolved: pct(sum('resolved'), prev.resolved),
    escalated: pct(sum('escalated'), prev.escalated),
    createdNow: sum('created'), resolvedNow: sum('resolved'), escalatedNow: sum('escalated'),
    createdPrev: prev.created, resolvedPrev: prev.resolved, escalatedPrev: prev.escalated,
  };

  const catRows = await safe(() => db.all(`
    SELECT c.name, COUNT(t.id)::int AS n FROM ticket_categories c
    LEFT JOIN tickets t ON t.category_id = c.id AND ${scope.sql}
    GROUP BY c.name ORDER BY n DESC`, ...scope.params), []);
  const catTotal = catRows.reduce((a, c) => a + c.n, 0) || 1;
  const categories = catRows.filter((c) => c.n > 0).slice(0, 6)
    .map((c) => ({ name: c.name, count: c.n, pct: Math.round((c.n / catTotal) * 100) }));

  const recent = await safe(() => db.all(`SELECT t.id, t.ticket_number, t.student_name, t.matric_no, t.status,
      t.created_at, i.name AS category, u.full_name AS assigned
    FROM tickets t
    LEFT JOIN ticket_categories c ON c.id = t.category_id
    LEFT JOIN ticket_issue_types i ON i.id = t.issue_type_id
    LEFT JOIN users u ON u.id = t.assigned_staff_id
    WHERE ${scope.sql}
    ORDER BY t.created_at DESC LIMIT 5`, ...scope.params), []);

  const activity = await safe(() => db.all(`SELECT actor_name, action, entity_type, entity_id, metadata, created_at
    FROM audit_logs ORDER BY created_at DESC LIMIT 6`), []);

  const unreadRow = await safe(() => db.get(`SELECT COUNT(*)::int AS n FROM contact_messages
    WHERE closed_at IS NULL AND status = 'new'${seniorOnlyWhere ? ` AND (${seniorOnlyWhere})` : ''}`, ...seniorOnlyParams), { n: 0 });

  res.json({
    period: { label },
    counts: {
      open: open?.n ?? 0, inProgress: inProgress?.n ?? 0, waiting: waiting?.n ?? 0,
      escalated: escalated?.n ?? 0, resolvedToday: resolvedToday?.n ?? 0, unassigned: unassigned?.n ?? 0,
    },
    trends, days, categories, recent, activity, unread: unreadRow?.n ?? 0,
  });
});

/* ------------------------ notification bell feed ------------------------ */

/**
 * What the bell shows: the newest things that need an officer's eyes.
 * One endpoint, one poll — no client-side stitching.
 */
router.get('/notifications', async (req, res) => {
  const since = new Date(Date.now() - 72 * 3600_000).toISOString(); // last 3 days max
  const [newTickets, studentReplies, escalations, inboxWaiting] = await Promise.all([
    db.all(`SELECT t.id, t.ticket_number, t.student_name, t.created_at, c.name AS category, i.name AS issue
       FROM tickets t JOIN ticket_categories c ON c.id = t.category_id JOIN ticket_issue_types i ON i.id = t.issue_type_id
       WHERE t.created_at >= ? ORDER BY t.created_at DESC LIMIT 6`, since),
    db.all(`SELECT m.ticket_id, m.sender_name, m.created_at, t.ticket_number
       FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id
       WHERE m.sender_role = 'student' AND m.created_at >= ? ORDER BY m.created_at DESC LIMIT 6`, since),
    db.all(`SELECT e.ticket_id, e.reason, e.escalated_by_name, e.specialty, e.created_at, t.ticket_number
       FROM escalations e JOIN tickets t ON t.id = e.ticket_id
       WHERE e.created_at >= ? ORDER BY e.created_at DESC LIMIT 5`, since),
    db.all(`SELECT id, sender_name, subject, created_at FROM contact_messages
       WHERE closed_at IS NULL AND status = 'new' ORDER BY created_at DESC LIMIT 5`),
  ]);
  const items = [
    ...newTickets.map((t) => ({ kind: 'new_ticket', id: `t${t.id}`, ticketId: t.id, title: t.ticket_number, detail: `${t.student_name} — ${t.category} · ${t.issue}`, at: t.created_at, to: `/admin/tickets/${t.id}` })),
    ...studentReplies.map((m) => ({ kind: 'student_reply', id: `r${m.ticket_id}${new Date(m.created_at).getTime()}`, ticketId: m.ticket_id, title: m.ticket_number, detail: `${m.sender_name} replied to ICT`, at: m.created_at, to: `/admin/tickets/${m.ticket_id}` })),
    ...escalations.map((e) => ({ kind: 'escalation', id: `e${e.ticket_id}${new Date(e.created_at).getTime()}`, ticketId: e.ticket_id, title: e.ticket_number, detail: `Escalated by ${e.escalated_by_name || 'ICT'} — ${e.specialty === 'payment' ? 'payment' : 'portal'} desk`, at: e.created_at, to: `/admin/tickets/${e.ticket_id}` })),
    ...inboxWaiting.map((m) => ({ kind: 'inbox', id: `m${m.id}`, inboxId: m.id, title: m.subject, detail: `${m.sender_name} is waiting for a reply`, at: m.created_at, to: `/admin/inbox` })),
  ].filter(Boolean).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12);
  res.json({ items, waiting: inboxWaiting.length });
});

router.get('/tickets', async (req, res) => {
  const { status, category, q, staff, from, to, escalated, unattended } = req.query;
  const scope = deskScope(req.user);
  const where = [scope.sql]; // seniors only see their own desk
  const params = [...scope.params];
  if (status && STATUSES.includes(status)) { where.push('t.status = ?'); params.push(status); }
  if (category && Number(category) > 0) { where.push('t.category_id = ?'); params.push(category); }
  if (staff === 'mine') { where.push('t.assigned_staff_id = ?'); params.push(req.user.id); }
  // "Unattended" = nobody has picked the complaint up yet — the first-line queue.
  if (unattended === '1') { where.push(`t.assigned_staff_id IS NULL AND t.status = 'open'`); }
  if (escalated === 'ever') {
    where.push(`EXISTS (SELECT 1 FROM ticket_status_history h WHERE h.ticket_id = t.id AND h.new_status = 'escalated')`);
  }
  if (req.query.student_replied === '1') {
    where.push(`EXISTS (SELECT 1 FROM ticket_messages m WHERE m.ticket_id = t.id AND m.sender_role = 'student')`);
  }
  if (from) { where.push(`t.created_at >= ?::date`); params.push(from); }
  if (to) { where.push(`t.created_at < (?::date + interval '1 day')`); params.push(to); }
  if (q) {
    where.push(`(t.ticket_number ILIKE ? OR t.student_name ILIKE ? OR t.matric_no ILIKE ? OR t.email ILIKE ?)`);
    const like = `%${String(q).slice(0, 80)}%`;
    params.push(like, like, like, like);
  }
  const rows = await db.all(`SELECT t.id, t.ticket_number, t.status, t.priority, t.created_at, t.updated_at,
            t.student_name, t.matric_no, t.department, t.level, t.email, t.desk,
            f.name AS faculty,
            c.name AS category, i.name AS issue,
            s.full_name AS assigned_staff,
            (SELECT COUNT(*) FROM ticket_status_history h WHERE h.ticket_id = t.id AND h.new_status = 'escalated') AS escalation_count,
            (SELECT COUNT(*)::int FROM ticket_messages m WHERE m.ticket_id = t.id AND m.sender_role = 'student') AS student_replies,
            (SELECT MAX(m.created_at) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.sender_role = 'student') AS last_student_reply,
            (SELECT m.sender_name FROM ticket_messages m WHERE m.ticket_id = t.id AND m.sender_role IN ('staff','senior','admin') ORDER BY m.id DESC LIMIT 1) AS attended_by_name
     FROM tickets t
     JOIN ticket_categories c ON c.id = t.category_id
     JOIN ticket_issue_types i ON i.id = t.issue_type_id
     LEFT JOIN faculties f ON f.id = t.faculty_id
     LEFT JOIN users s ON s.id = t.assigned_staff_id
     WHERE ${where.filter(Boolean).join(' AND ') || '1=1'}
     ORDER BY t.created_at DESC LIMIT 200`, ...params);
  res.json({ tickets: rows });
});

/* -------------------------- senior: escalations ----------------------- */

/**
 * Escalated queue for Senior Engineers (and admins).
 * Each senior sees the complaints that match their speciality — payment
 * seniors see payment complaints, portal seniors see portal complaints.
 * Super ICT Support sees everything, tagged by kind.
 */
router.get('/escalations', requireSenior, async (req, res) => {
  const scope = req.user.role === 'admin' || !req.user.specialty
    ? ''
    : 'AND e.specialty = ?';
  const params = req.user.role === 'admin' || !req.user.specialty ? [] : [req.user.specialty];
  const rows = await db.all(`SELECT t.id, t.ticket_number, t.status, t.priority, t.created_at, t.updated_at,
            t.student_name, t.matric_no, t.department, t.level, t.description,
            f.name AS faculty,
            c.name AS category, i.name AS issue,
            e.reason AS escalation_reason, e.escalated_by_name, e.escalated_by_staff_no, e.created_at AS escalated_at,
            e.specialty
     FROM tickets t
     JOIN escalations e ON e.ticket_id = t.id AND e.resolved_at IS NULL
     JOIN ticket_categories c ON c.id = t.category_id
     JOIN ticket_issue_types i ON i.id = t.issue_type_id
     LEFT JOIN faculties f ON f.id = t.faculty_id
     WHERE t.status = 'escalated' ${scope}
     ORDER BY e.created_at`, ...params);
  res.json({ escalations: rows });
});

/* ----------------------------- detail -------------------------------- */

router.get('/tickets/:id', async (req, res) => {
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (!await guardDesk(req, res, t)) return;
  const cat = await db.get('SELECT name FROM ticket_categories WHERE id = ?', t.category_id);
  const issue = await db.get('SELECT name FROM ticket_issue_types WHERE id = ?', t.issue_type_id);
  const faculty = t.faculty_id ? await db.get('SELECT name FROM faculties WHERE id = ?', t.faculty_id) : null;
  const department = t.department_id ? await db.get('SELECT name, kind FROM departments WHERE id = ?', t.department_id) : null;

  const messages = await db.all(`SELECT m.id, m.message, m.visibility, m.sender_role, m.created_at, m.sender_name
     FROM ticket_messages m WHERE m.ticket_id = ? ORDER BY m.created_at`, t.id);
  const attachments = await db.all(`SELECT id, original_filename, mime_type, size, created_at, uploaded_by FROM ticket_attachments WHERE ticket_id = ?`, t.id);
  const payment = await db.get(`SELECT p.*, u.full_name AS verified_by_name FROM ticket_payment_details p
     LEFT JOIN users u ON u.id = p.verified_by WHERE p.ticket_id = ?`, t.id) || null;
  const history = await db.all(`SELECT old_status, new_status, note, changed_by, created_at FROM ticket_status_history WHERE ticket_id = ? ORDER BY created_at`, t.id);
  const staffList = await db.all(`SELECT id, full_name, role, staff_no FROM users WHERE active = 1
     ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'senior' THEN 1 ELSE 2 END`);

  // Latest escalation record — the identity block Senior Engineers must see (§21).
  const escalation = await db.get(`SELECT e.*, u.full_name AS escalater_name, u.staff_no
     FROM escalations e LEFT JOIN users u ON u.id = e.escalated_by
     WHERE e.ticket_id = ? ORDER BY e.id DESC LIMIT 1`, t.id) || null;

  // Previous complaints from the same student (§16).
  let studentHistory = [];
  let student = null;
  if (t.student_id) {
    const s = await db.get('SELECT * FROM students WHERE id = ?', t.student_id);
    if (s) {
      student = {
        id: s.id, fullName: s.full_name, matricNo: s.matric_no,
        email: s.email, phone: s.phone,
        faculty: faculty?.name || null, department: department?.name || t.department,
        level: t.level,
        ticketCount: (await db.get('SELECT COUNT(*) AS n FROM tickets WHERE student_id = ?', s.id)).n,
      };
      studentHistory = await db.all(`SELECT t.id, t.ticket_number, t.status, t.created_at, c.name AS category
         FROM tickets t JOIN ticket_categories c ON c.id = t.category_id
         WHERE t.student_id = ? AND t.id != ? ORDER BY t.created_at DESC LIMIT 10`, s.id, t.id);
    }
  }
  if (!student) {
    student = {
      fullName: t.student_name, matricNo: t.matric_no, email: t.email, phone: t.phone,
      faculty: faculty?.name || null, department: department?.name || t.department, level: t.level,
      ticketCount: null,
    };
  }

  // Role-accurate stage options: while a ticket sits in 'escalated', only a
  // Senior Engineer may move it (resolve/reject/re-open). Everyone else —
  // first-line ICT Support AND Super ICT Support — gets no stage buttons;
  // they can still reply and add notes (that is not a stage move).
  const transitions = (TRANSITIONS[t.status] || []).filter((s) =>
    t.status === 'escalated' ? req.user.role === 'senior' : true);
  res.json({
    ticket: { ...t, details: t.details ? JSON.parse(t.details || '{}') : {}, category: cat?.name, issue: issue?.name },
    student, studentHistory, messages, attachments, payment, history, staffList, escalation,
    allowedTransitions: transitions,
    viewerRole: req.user.role,
  });
});

/* --------------------------- messages -------------------------------- */

router.post('/tickets/:id/reply', async (req, res) => {
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (!await guardDesk(req, res, t)) return;
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Type a message first' });
  await db.run(`INSERT INTO ticket_messages (ticket_id, sender_name, sender_role, message, visibility)
     VALUES (?, ?, ?, ?, 'student')`, t.id, req.user.full_name, req.user.role, message.slice(0, 4000));
  await db.run('UPDATE tickets SET updated_at = now() WHERE id = ?', t.id);
  // Email only when ICT chooses to (emailIt: true) — the conversation lives on
  // the tracking page either way. Keeps the student's inbox quiet.
  if (req.body?.emailIt) {
    notifyStudent(t, `RUGIPO ICT replied — ${t.ticket_number}`,
      `Hello ${t.student_name},\n\nICT replied to your complaint ${t.ticket_number}:\n\n"${message}"\n\nTrack it and reply here: ${process.env.PUBLIC_BASE_URL || ''}/track\n\n— RUGIPO ICT Support`,
      'reply');
  }
  audit(req, 'ticket.reply', t.id, { emailed: !!req.body?.emailIt });
  res.json({ ok: true });
});

router.post('/tickets/:id/note', async (req, res) => {
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (!await guardDesk(req, res, t)) return;
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Type a note first' });
  await db.run(`INSERT INTO ticket_messages (ticket_id, sender_name, sender_role, message, visibility)
     VALUES (?, ?, ?, ?, 'internal')`, t.id, req.user.full_name, req.user.role, message.slice(0, 4000));
  audit(req, 'ticket.note', t.id, {});
  res.json({ ok: true });
});

/* ------------------------- status transitions ------------------------- */

router.post('/tickets/:id/status', async (req, res) => {
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (!await guardDesk(req, res, t)) return;
  const next = String(req.body?.status || '');
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  if (!STATUSES.includes(next)) return res.status(400).json({ error: 'Unknown status' });
  const allowed = TRANSITIONS[t.status] || [];
  if (!allowed.includes(next)) {
    return res.status(400).json({ error: `Cannot move from ${t.status} to ${next}` });
  }

  // RBAC: resolving or re-staging an escalated ticket is the Senior
  // Engineers' exclusive job — first-line ICT Support AND Super ICT Support
  // are both locked out (Super runs the dashboard, but the resolution itself
  // belongs to the desk seniors).
  const leavingEscalated = t.status === 'escalated' && next !== 'escalated';
  if (leavingEscalated && req.user.role !== 'senior') {
    return res.status(403).json({ error: 'Resolving an escalated complaint belongs to the specialist engineers — Portal Support or Payment Gateway. You can still reply to the student and add internal notes.' });
  }
  // Escalation REQUIRES a reason (§20).
  if (next === 'escalated' && !(note && note.trim().length >= 5)) {
    return res.status(400).json({ error: 'An escalation reason is required (at least 5 characters).' });
  }

  const tx = db.transaction(async () => {
    await db.run(`UPDATE tickets SET status = ?, updated_at = now(),
                resolved_at = CASE WHEN ? IN ('resolved','closed') THEN now() ELSE resolved_at END
                WHERE id = ?`, next, next, t.id);
    await db.run(`INSERT INTO ticket_status_history (ticket_id, old_status, new_status, changed_by, note)
                VALUES (?, ?, ?, ?, ?)`, t.id, t.status, next, req.user.full_name, note);

    if (next === 'escalated') {
      // Route by kind: payment complaints (the ticket carries payment details)
      // go to the payment seniors; everything else to the portal seniors.
      const spec = await ticketSpecialty(t.id);
      await db.run(`INSERT INTO escalations (ticket_id, escalated_by, escalated_by_name, escalated_by_staff_no, reason, from_status, specialty)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, t.id, req.user.id, req.user.full_name, req.user.staff_no || null, note.trim(), t.status, spec);
      await db.run(`INSERT INTO ticket_messages (ticket_id, sender_name, sender_role, message, visibility)
                  VALUES (?, 'System', 'system', ?, 'internal')`, t.id, `Escalated to Senior ICT Engineers by ${req.user.full_name} (${req.user.staff_no || 'no staff ID'}). Reason: ${note.trim()}`);
    }
    if (leavingEscalated) {
      await db.run(`UPDATE escalations SET resolved_by = ?, resolved_by_name = ?, resolved_at = now()
                  WHERE ticket_id = ? AND resolved_at IS NULL`, req.user.id, req.user.full_name, t.id);
    }
    if (next === 'resolved') {
      await db.run(`INSERT INTO ticket_messages (ticket_id, sender_name, sender_role, message, visibility)
                  VALUES (?, 'System', 'system', ?, 'student')`, t.id, `Your complaint has been marked RESOLVED.${note ? ' ' + note : ''}`);
    }
  });
  await tx();

  if (next === 'escalated') {
    const spec = await ticketSpecialty(t.id);
    const specLabel = spec === 'payment' ? 'Payment' : 'Portal';
    // ONLY the seniors whose desk owns this complaint get the escalation
    // email. Super ICT Support sees it in the dashboard but is never mailed —
    // the officers who must act are the ones who get woken up.
    const routed = await db.all(
      `SELECT email, full_name FROM users WHERE role = 'senior' AND active = 1 AND specialty = ?`, spec);
    for (const a of routed) {
      queueEmail({
        ticketId: t.id, to: a.email, kind: 'escalation',
        subject: `⬆ ${specLabel} complaint ${t.ticket_number} needs your review`,
        body: `A ${specLabel.toLowerCase()} payment/portal complaint has been escalated and routed to you.\n\nTicket: ${t.ticket_number} (${t.category} — ${t.issue})\nStudent: ${t.student_name} (${t.matric_no})\nEscalated by: ${req.user.full_name} (${req.user.staff_no || 'no staff ID'})\nReason: ${note}\n\nOpen your dashboard to review it.`,
      });
    }
    // No email to the student here — escalation is an internal step; they see
    // it on the tracking page, and the eventual resolution is what gets mailed.
  } else if (next === 'resolved' || next === 'closed') {
    // THE core requirement (§23): resolving a ticket messages the student's
    // saved email automatically — the resolver never types an email address.
    notifyStudent(t,
      `✅ Resolved: your complaint ${t.ticket_number} has been solved`,
      `Hello ${t.student_name},\n\nGood news — your complaint ${t.ticket_number} (${t.category} — ${t.issue}) has been RESOLVED.\n\n${note ? 'ICT note: ' + note + '\n\n' : ''}If the problem happens again, reply on your ticket page or log a new complaint with your Tracking ID.\n\nThank you for your patience.\n— RUGIPO ICT Support, Rufus Giwa Polytechnic, Owo`,
      'resolved');
  } else if (next === 'waiting_student' || next === 'rejected') {
    // Only email the student when their input is needed or the complaint was
    // rejected. Routine internal stages (assigned, in progress, escalated)
    // stay silent — the tracking page shows them live.
    notifyStudent(t,
      next === 'waiting_student'
        ? `We need one more thing from you — ${t.ticket_number}`
        : `Update on your complaint ${t.ticket_number}`,
      next === 'waiting_student'
        ? `Hello ${t.student_name},\n\nTo keep working on your complaint ${t.ticket_number}, ICT needs something from you:\n\n${note || 'Open the tracking page — the officer has asked a question there.'}\n\nReply on the tracking page (${process.env.PUBLIC_BASE_URL || ''}/track) and we continue from there.\n\n— RUGIPO ICT Support`
        : `Hello ${t.student_name},\n\nYour complaint ${t.ticket_number} was not accepted as an ICT complaint.${note ? '\n\nReason: ' + note : ''}\n\nIf you think this is a mistake, reply on the tracking page.\n\n— RUGIPO ICT Support`,
      next === 'waiting_student' ? 'needs_student' : 'status');
  }
  // assigned / in_progress / open / re-opened → no email (keep the inbox quiet).

  audit(req, 'ticket.status', t.id, { from: t.status, to: next, reason: note });
  res.json({ ok: true });
});

router.post('/tickets/:id/assign', async (req, res) => {
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (!await guardDesk(req, res, t)) return;
  // Any active ICT Support officer can hand a complaint to a colleague —
  // first-line triage is everyone's job. Seniors/admins can too.
  const staffId = parseInt(req.body?.staffId, 10);
  const staff = await db.get(`SELECT * FROM users WHERE id = ? AND active = 1`, staffId);
  if (!staff) return res.status(400).json({ error: 'Choose a valid staff member' });
  const tx = db.transaction(async () => {
    await db.run(`UPDATE ticket_assignments SET unassigned_at = now() WHERE ticket_id = ? AND unassigned_at IS NULL`, t.id);
    await db.run(`INSERT INTO ticket_assignments (ticket_id, staff_id, assigned_by) VALUES (?, ?, ?)`, t.id, staffId, req.user.id);
    const newStatus = t.status === 'open' ? 'assigned' : t.status;
    await db.run(`UPDATE tickets SET assigned_staff_id = ?, status = ?, updated_at = now() WHERE id = ?`, staffId, newStatus, t.id);
    await db.run(`INSERT INTO ticket_status_history (ticket_id, old_status, new_status, changed_by, note)
                VALUES (?, ?, ?, ?, ?)`, t.id, t.status, newStatus, req.user.full_name, `Assigned to ${staff.full_name}`);
    await queueEmail({ ticketId: t.id, to: staff.email, kind: 'assignment',
      subject: `Complaint ${t.ticket_number} assigned to you`,
      body: `Hello ${staff.full_name},\n\n${req.user.full_name} assigned complaint ${t.ticket_number} to you.\nStudent: ${t.student_name} (${t.matric_no})\nIssue: ${t.department} — ${t.description?.slice(0, 140)}\n\nOpen the ICT Staff Portal to attend to it.\n\n— RUGIPO ICT Support` });
  });
  await tx();
  audit(req, 'ticket.assign', t.id, { staffId });
  res.json({ ok: true });
});

/* --------------------- payment verification --------------------------- */

router.post('/tickets/:id/verify-payment', async (req, res) => {
  const t = await db.get('SELECT * FROM tickets WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (!await guardDesk(req, res, t)) return;
  const p = await db.get('SELECT * FROM ticket_payment_details WHERE ticket_id = ?', t.id);
  if (!p) return res.status(400).json({ error: 'This ticket has no payment details' });
  const outcome = String(req.body?.outcome || '');
  if (!['verified', 'failed_verification'].includes(outcome)) {
    return res.status(400).json({ error: 'Outcome must be verified or failed_verification' });
  }
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  await db.run(`UPDATE ticket_payment_details SET verification_status = ?, verified_by = ?, verified_at = now() WHERE id = ?`, outcome, req.user.id, p.id);
  await db.run(`INSERT INTO ticket_messages (ticket_id, sender_name, sender_role, message, visibility)
     VALUES (?, ?, ?, ?, 'internal')`, t.id, req.user.full_name, req.user.role, `Payment verification: ${outcome}${note ? ' — ' + note : ''}`);
  audit(req, 'payment.verify', t.id, { outcome });
  res.json({ ok: true });
});

/* --------------------------- analytics -------------------------------- */

/**
 * Reports — every number respects the chosen period: a single day, a month,
 * a whole year, or an explicit from/to range.
 *   ?day=2026-09-18   → that one day
 *   ?month=2026-09    → that whole month
 *   ?year=2026        → that whole year
 *   ?from=&to=        → explicit range (to is inclusive)
 * No parameter → the last 30 days (the default view).
 */
function periodClause(q, params, column = 't.created_at') {
  if (q.day) { params.push(q.day, q.day); return `${column} >= ?::date AND ${column} < (?::date + interval '1 day')`; }
  if (q.month) { params.push(q.month + '-01', q.month + '-01'); return `${column} >= ?::date AND ${column} < (?::date + interval '1 month')`; }
  if (q.year) { params.push(q.year + '-01-01', q.year + '-01-01'); return `${column} >= ?::date AND ${column} < (?::date + interval '1 year')`; }
  if (q.from && q.to) { params.push(q.from, q.to); return `${column} >= ?::date AND ${column} < (?::date + interval '1 day')`; }
  return `${column} >= now() - interval '29 days'`;
}

router.get('/analytics', async (req, res) => {
  const params = [];
  const scope = deskScope(req.user); // seniors report on their own desk only
  const where = `WHERE ${scope.sql} AND ${periodClause(req.query, params)}`;
  // Grain for the trend chart follows the period: hours in a day, days in a
  // month/range, months in a year.
  const grain = req.query.day ? 'HH24:00' : req.query.year && !req.query.month && !req.query.day ? 'YYYY-MM' : 'YYYY-MM-DD';
  const trendSpan = req.query.day ? "created_at >= now() - interval '0 days'" : null;

  const trendParams = [];
  let trendWhere;
  if (req.query.day) { trendParams.push(req.query.day); trendWhere = `created_at >= ?::date AND created_at < (?::date + interval '1 day')`; trendParams.push(req.query.day); }
  else if (req.query.month) { trendParams.push(req.query.month + '-01'); trendWhere = `created_at >= ?::date AND created_at < (?::date + interval '1 month')`; trendParams.push(req.query.month + '-01'); }
  else if (req.query.year) { trendParams.push(req.query.year + '-01-01'); trendWhere = `created_at >= ?::date AND created_at < (?::date + interval '1 year')`; trendParams.push(req.query.year + '-01-01'); }
  else if (req.query.from && req.query.to) { trendParams.push(req.query.from, req.query.to); trendWhere = `created_at >= ?::date AND created_at < (?::date + interval '1 day')`; }
  else trendWhere = `created_at >= now() - interval '29 days'`;

  const byDay = await db.all(`SELECT to_char(created_at, '${grain}') AS day, COUNT(*)::int AS n FROM tickets
     WHERE ${trendWhere} AND ${scope.sql} GROUP BY 1 ORDER BY 1`, ...scope.params, ...trendParams);
  const byCategory = await db.all(`SELECT c.id, c.name, COUNT(*)::int AS n FROM tickets t JOIN ticket_categories c ON c.id=t.category_id ${where} GROUP BY c.id ORDER BY n DESC`, ...params);
  const byStatus = await db.all(`SELECT status, COUNT(*)::int AS n FROM tickets t ${where} GROUP BY status`, ...params);
  const totals = await db.get(`SELECT COUNT(*)::int AS total,
     COUNT(*) FILTER (WHERE t.status IN ('resolved','closed'))::int AS resolved,
     COUNT(*) FILTER (WHERE t.status = 'escalated')::int AS now_escalated,
     COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM ticket_status_history h WHERE h.ticket_id = t.id AND h.new_status = 'escalated'))::int AS ever_escalated,
     COUNT(*) FILTER (WHERE t.status = 'open')::int AS still_open,
     COUNT(*) FILTER (WHERE t.assigned_staff_id IS NULL AND t.status = 'open')::int AS unattended,
     COUNT(DISTINCT t.email)::int AS unique_students
     FROM tickets t ${where}`, ...params);
  const totalsCamel = { total: totals.total, resolved: totals.resolved, nowEscalated: totals.now_escalated, everEscalated: totals.ever_escalated, stillOpen: totals.still_open, unattended: totals.unattended, uniqueStudents: totals.unique_students };
  const avgParams = [];
  const avgWhere = periodClause(req.query, avgParams, 'created_at');
  const avgResolution = (await db.get(`SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0) AS hours FROM tickets WHERE resolved_at IS NOT NULL AND ${scope.sql} AND ${avgWhere}`, ...scope.params, ...avgParams)).hours;
  const fastest = await db.get(`SELECT MIN(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0) AS h FROM tickets WHERE resolved_at IS NOT NULL AND ${scope.sql} AND ${avgWhere}`, ...scope.params, ...avgParams);
  const slowest = await db.get(`SELECT MAX(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0) AS h FROM tickets WHERE resolved_at IS NOT NULL AND ${scope.sql} AND ${avgWhere}`, ...scope.params, ...avgParams);
  const byDepartment = await db.all(`SELECT COALESCE(t.department,'(none)') AS dept, COUNT(*)::int AS n FROM tickets t ${where} GROUP BY dept ORDER BY n DESC LIMIT 10`, ...params);
  const byFaculty = await db.all(`SELECT COALESCE(f.name,'(none)') AS faculty, COUNT(*)::int AS n
     FROM tickets t LEFT JOIN faculties f ON f.id = t.faculty_id ${where} GROUP BY f.id ORDER BY n DESC`, ...params);
  const byLevelMode = await db.all(`SELECT COALESCE(t.academic_level,'(none)') AS lvl, COALESCE(t.study_mode,'(none)') AS mode, COUNT(*)::int AS n
     FROM tickets t ${where} GROUP BY lvl, mode ORDER BY n DESC`, ...params);
  const staffWorkload = await db.all(`SELECT COALESCE(s.full_name,'(unassigned)') AS staff, COUNT(*)::int AS n,
     COUNT(*) FILTER (WHERE t.status IN ('resolved','closed'))::int AS done
     FROM tickets t LEFT JOIN users s ON s.id=t.assigned_staff_id ${where} GROUP BY s.id ORDER BY n DESC`, ...params);
  const payments = await db.all(`SELECT p.verification_status, COUNT(*)::int AS n FROM ticket_payment_details p
     JOIN tickets t ON t.id = p.ticket_id ${where} GROUP BY p.verification_status`, ...params);
  const scoped = req.user.role === 'senior';
  const escParams = [];
  const escWhere = periodClause(req.query, escParams, 't.created_at');
  const escalationsByKind = await db.all(`SELECT e.specialty, COUNT(*)::int AS n FROM escalations e
     JOIN tickets t ON t.id = e.ticket_id WHERE ${escWhere} GROUP BY e.specialty`, ...escParams);
  const escalations = escalationsByKind.reduce((a, k) => a + k.n, 0);
  const subscribers = (await db.get(`SELECT COUNT(*)::int AS n FROM subscribers WHERE unsubscribed_at IS NULL`)).n;
  const period = {
    label: req.query.day ? `Day: ${req.query.day}`
      : req.query.month ? `Month: ${req.query.month}`
      : req.query.year ? `Year: ${req.query.year}`
      : req.query.from ? `From ${req.query.from} to ${req.query.to}`
      : 'Last 30 days',
  };
  res.json({
    period,
    byDay, byCategory, byStatus, totals: totalsCamel,
    avgResolutionHours: avgResolution,
    fastestResolutionHours: fastest?.h ?? null,
    slowestResolutionHours: slowest?.h ?? null,
    byDepartment, byFaculty, byLevelMode, staffWorkload, payments,
    escalationsByKind, escalations,
    // Subscribers are an administration-wide figure — not shown to desk seniors.
    subscribers: scoped ? null : subscribers,
  });
});

/* ------------------- admin: staff + newsletter ------------------------- */

router.get('/admin/subscribers', requireAdmin, async (_req, res) => {
  const rows = await db.all(`SELECT email, name, matric_no, source, created_at FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY created_at DESC`);
  res.json({ subscribers: rows });
});

router.post('/admin/broadcast', requireAdmin, async (req, res) => {
  const subject = String(req.body?.subject || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!subject || !body) return res.status(400).json({ error: 'Subject and message are required' });
  const subs = await db.all(`SELECT email FROM subscribers WHERE unsubscribed_at IS NULL`);
  for (const s of subs) {
    queueEmail({ to: s.email, subject: `RUGIPO ICT: ${subject}`, body: `${body}\n\n— RUGIPO ICT Support`, kind: 'broadcast' });
  }
  await db.run(`INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata)
              VALUES (?, ?, 'newsletter.broadcast', 'broadcast', NULL, ?)`, req.user.id, req.user.full_name, JSON.stringify({ recipients: subs.length, subject }));
  res.json({ ok: true, queued: subs.length });
});

// READ is open to every signed-in officer (ICT Support sees the pages but
// every write is rejected by requireSuper) — so staff know the structure
// without being able to touch it.
router.get('/admin/staff', requireStaff, async (_req, res) => {
  const rows = await db.all(`SELECT id, full_name, email, role, staff_no, gender, profile_image, must_change_password, phone, specialty, active, created_at FROM users ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'senior' THEN 1 ELSE 2 END, full_name`);
  res.json({ staff: rows });
});

/**
 * Create an account — Super ICT Support ONLY (no public registration).
 * role must be 'staff' (ICT Support) or 'senior' (Senior Engineer); creating
 * another 'admin' happens only through the explicit promote endpoint.
 */
/** Heritage's three staff categories → the role/specialty the portal runs on. */
const CATEGORY_MAP = {
  'ict-support': { role: 'staff', specialty: null },
  'senior-engineer': { role: 'senior', specialty: 'portal' },
  'payment-provider': { role: 'senior', specialty: 'payment' },
};

router.post('/admin/staff', requireAdmin, async (req, res) => {
  const { fullName, email, staffNo, gender, phone } = req.body || {};
  const category = CATEGORY_MAP[String(req.body?.category || '')] || null;
  // The legacy role+specialty shape still works so nothing else breaks.
  const legacyRole = String(req.body?.role || '');
  const legacySpecialty = String(req.body?.specialty || '').toLowerCase();
  const role = category ? category.role : legacyRole;
  const specialty = category ? category.specialty
    : (role === 'senior' && ['payment', 'portal'].includes(legacySpecialty) ? legacySpecialty : null);
  // Default password is literally "password" — the portal forces a change at
  // first sign-in, so a shared starter password is safe.
  const password = String(req.body?.password || '').trim() || 'password';
  if (!fullName || !email || !['staff', 'senior'].includes(role)) {
    return res.status(400).json({ error: 'Name, email and role are required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ error: 'Enter a valid email address' });
  if (gender && !['male', 'female'].includes(String(gender).toLowerCase())) {
    return res.status(400).json({ error: 'Gender must be male or female' });
  }
  const exists = await db.get('SELECT id FROM users WHERE email = ?', String(email).trim().toLowerCase());
  if (exists) return res.status(409).json({ error: 'An account with this email already exists' });
  const roleLabel = role === 'senior'
    ? (specialty === 'payment' ? 'Payment Gateway Provider' : 'Portal Support Engineer')
    : 'ICT Support Staff';
  const info = await db.run(`INSERT INTO users (role, full_name, email, password_hash, staff_no, gender, phone, specialty, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, role, String(fullName).trim().slice(0, 120), String(email).trim().toLowerCase(),
    bcrypt.hashSync(String(password), 12),
    staffNo ? String(staffNo).trim().slice(0, 40) : null,
    gender ? String(gender).toLowerCase() : null,
    phone ? String(phone).slice(0, 30) : null,
    specialty);
  audit(req, 'staff.create', info.lastInsertRowid, { email, role, specialty });
  // Welcome email — tells the new staff member to sign in with the shared password.
  queueEmail({
    to: String(email).trim().toLowerCase(),
    kind: 'staff-welcome',
    subject: `Your RUGIPO ICT Support account is ready`,
    body: `Hello ${String(fullName).trim()},\n\nAn account has been created for you on the RUGIPO ICT Support portal.\n\nRole: ${roleLabel}${staffNo ? `\nStaff ID: ${staffNo}` : ''}\nSign in here: ${process.env.PUBLIC_BASE_URL || ''}/admin\nEmail: ${String(email).trim().toLowerCase()}\nTemporary password: ${password}\n\nIMPORTANT: The first time you sign in, the system will ask you to choose your own password and add your profile details. You must complete this before you can work on complaints.\n\n— RUGIPO ICT Support, Rufus Giwa Polytechnic, Owo`,
  });
  res.json({ ok: true, id: info.lastInsertRowid });
});

/**
 * Promote / demote between ICT Support ↔ Senior Engineer. Super-only.
 * Demoting ANOTHER Super requires typing their email (same guard as promote)
 * so a mistaken promotion can be undone — but you can never change your own role.
 */
router.post('/admin/staff/:id/role', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ? AND active = 1', req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  const role = String(req.body?.role || '');
  if (!['staff', 'senior'].includes(role)) return res.status(400).json({ error: 'Role must be staff or senior' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });
  if (target.role === 'admin') {
    const confirm = String(req.body?.confirm || '');
    if (confirm !== target.email) {
      return res.status(400).json({ error: `Type the account email (${target.email}) to confirm removing Super ICT Support powers` });
    }
  }
  // Speciality travels with the role change (seniors must have one).
  const specialtyRaw = String(req.body?.specialty || '').toLowerCase();
  const specialty = role === 'senior' && ['payment', 'portal'].includes(specialtyRaw)
    ? specialtyRaw
    : (role === 'senior' ? (target.specialty || 'portal') : null);
  await db.run('UPDATE users SET role = ?, specialty = ? WHERE id = ?', role, specialty, target.id);
  audit(req, 'staff.role', target.id, { from: target.role, to: role, specialty });
  res.json({ ok: true });
});

/** Change which kind of complaints a Senior Engineer handles. Super-only. */
router.post('/admin/staff/:id/specialty', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ? AND active = 1', req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (target.role !== 'senior') return res.status(400).json({ error: 'Only Senior Engineers have a speciality' });
  const specialty = String(req.body?.specialty || '').toLowerCase();
  if (!['payment', 'portal'].includes(specialty)) {
    return res.status(400).json({ error: 'Speciality must be payment or portal' });
  }
  await db.run('UPDATE users SET specialty = ? WHERE id = ?', specialty, target.id);
  audit(req, 'staff.specialty', target.id, { email: target.email, specialty });
  res.json({ ok: true });
});

/** Hand Super ICT Support powers to a trusted account (irreversible via UI). */
router.post('/admin/staff/:id/promote-super', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ? AND active = 1', req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (target.role === 'admin') return res.status(400).json({ error: 'This account is already a Super ICT Support' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You are already a Super ICT Support' });
  const confirm = String(req.body?.confirm || '');
  if (confirm !== target.email) {
    return res.status(400).json({ error: `Type the account email (${target.email}) to confirm promotion to Super` });
  }
  await db.run("UPDATE users SET role = 'admin' WHERE id = ?", target.id);
  audit(req, 'staff.promote-super', target.id, { email: target.email });
  res.json({ ok: true });
});

/** Activate / deactivate an account. Self-deactivation is blocked. */
router.post('/admin/staff/:id/active', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  const active = req.body?.active ? 1 : 0;
  await db.run('UPDATE users SET active = ? WHERE id = ?', active, target.id);
  audit(req, 'staff.active', target.id, { active: !!active, email: target.email });
  res.json({ ok: true });
});

/**
 * Delete a staff account permanently — Super only. For clearing out test
 * accounts or staff who have left, which also frees their email for a new
 * account. Nothing in the history breaks: names are stored as text on every
 * record, links that may be empty are set to NULL, and only the raw
 * hand-over rows (which cannot exist without the person) are removed.
 * Your own account and other Super ICT Support accounts are protected.
 */
router.delete('/admin/staff/:id', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  if (target.role === 'admin') {
    return res.status(403).json({ error: 'Super ICT Support accounts are protected — remove their powers first' });
  }
  // Detach the account from everything that references it.
  await db.run('UPDATE tickets SET assigned_staff_id = NULL WHERE assigned_staff_id = ?', target.id);
  await db.run('DELETE FROM ticket_assignments WHERE staff_id = ?', target.id);
  await db.run('UPDATE ticket_assignments SET assigned_by = NULL WHERE assigned_by = ?', target.id);
  await db.run('UPDATE ticket_payment_details SET verified_by = NULL WHERE verified_by = ?', target.id);
  await db.run('UPDATE escalations SET escalated_by = NULL WHERE escalated_by = ?', target.id);
  await db.run('UPDATE escalations SET resolved_by = NULL WHERE resolved_by = ?', target.id);
  await db.run('UPDATE ticket_status_history SET changed_by = NULL WHERE changed_by = ?', target.id);
  await db.run('UPDATE contact_messages SET replied_by = NULL WHERE replied_by = ?', target.id);
  await db.run('UPDATE audit_logs SET actor_id = NULL WHERE actor_id = ?', target.id);
  await db.run('UPDATE announcements SET created_by = NULL WHERE created_by = ?', target.id);
  await db.run('DELETE FROM users WHERE id = ?', target.id);
  audit(req, 'staff.delete', target.id, { email: target.email, name: target.full_name });
  res.json({ ok: true });
});

/**
 * Reset a staff member's password — Super only. The account is left active
 * and NOT forced through first-login setup (must_change_password stays 0) so
 * the password you choose works immediately; the colleague changes it later
 * from My Profile. Used when someone forgets theirs or for issuing test logins.
 */
router.post('/admin/staff/:id/reset-password', requireAdmin, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  // One click → back to the shared temporary password "password". The portal
  // forces them to choose their own at next sign-in, so the temporary value
  // never lasts. A custom typed password is still allowed (kept for flexibility).
  const typed = String(req.body?.password || '').trim();
  let password = 'password';
  if (typed) {
    if (typed.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!/[A-Za-z]/.test(typed) || !/[0-9]/.test(typed)) {
      return res.status(400).json({ error: 'Password must contain letters and numbers' });
    }
    password = typed;
  }
  await db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
    bcrypt.hashSync(password, 12), target.id);
  audit(req, 'staff.reset-password', target.id, { email: target.email });
  // Tell them — otherwise they think their account is broken.
  queueEmail({
    to: target.email,
    kind: 'staff-password-reset',
    subject: 'Your RUGIPO ICT Support password was reset',
    body: `Hello ${target.full_name},\n\nYour sign-in password for the RUGIPO ICT Support portal was reset by the Super ICT Support.\n\nSign in here: ${process.env.PUBLIC_BASE_URL || ''}/admin\nEmail: ${target.email}\nTemporary password: ${password}\n\nThe portal will ask you to choose your own password immediately after signing in.\n\nIf you did not expect this, contact the Super ICT Support right away.\n\n— RUGIPO ICT Support, Rufus Giwa Polytechnic, Owo`,
  });
  res.json({ ok: true, temporary: password });
});

/* --------------------------- admin: audit log --------------------------- */

/** Audit trail — who did what, to which ticket, when. Filterable by action or ticket. */
// Officers can review the trail (read-only); nothing here mutates data.
router.get('/admin/audit-log', requireStaff, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const action = String(req.query.action || '').trim();
  const ticket = String(req.query.ticket || '').trim();
  const where = [];
  const params = [];
  if (action) { where.push('a.action ILIKE ?'); params.push(`%${action}%`); }
  if (ticket) { where.push('t.ticket_number ILIKE ?'); params.push(`%${ticket}%`); }
  const rows = await db.all(`SELECT a.id, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
             t.ticket_number, t.student_name, i.name AS issue
      FROM audit_logs a
      LEFT JOIN tickets t ON t.id = a.entity_id AND a.entity_type = 'ticket'
      LEFT JOIN ticket_issue_types i ON i.id = t.issue_type_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC
      LIMIT ?`, limit);
  const actions = await db.all(`SELECT action, COUNT(*)::int AS n FROM audit_logs GROUP BY action ORDER BY n DESC`);
  res.json({ entries: rows, actions });
});

/* ------------- admin: academic master data + service catalogue ---------- */

// Read-only for all officers; writes stay Super-only (requireSuper below).
router.get('/admin/master-data', requireStaff, async (_req, res) => {
  const faculties = await db.all(`SELECT f.id, f.name, f.active,
            (SELECT COUNT(*) FROM departments d WHERE d.faculty_id = f.id) AS department_count
     FROM faculties f ORDER BY f.sort_order`);
  const departments = await db.all(`SELECT d.id, d.name, d.faculty_id, f.name AS faculty, d.kind, d.active
     FROM departments d JOIN faculties f ON f.id = d.faculty_id
     ORDER BY f.sort_order, d.name`);
  const categories = (await db.all(`SELECT c.id, c.name, c.description, c.guided_fields, c.active,
            (SELECT COUNT(*) FROM ticket_issue_types i WHERE i.category_id = c.id) AS issue_count
     FROM ticket_categories c ORDER BY c.sort_order`)).map((c) => ({ ...c, guided_fields: c.guided_fields ? JSON.parse(c.guided_fields) : [] }));
  res.json({ faculties, departments, categories });
});

router.post('/admin/faculties', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Faculty name is required' });
  try {
    const info = await db.run(`INSERT INTO faculties (name) VALUES (?)`, name.slice(0, 120));
    audit(req, 'masterdata.faculty.create', info.lastInsertRowid, { name });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: 'A faculty with that name already exists' });
  }
});

router.post('/admin/departments', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const facultyId = parseInt(req.body?.facultyId, 10);
  const kind = ['academic', 'unit', 'center'].includes(req.body?.kind) ? req.body.kind : 'academic';
  if (!name || !facultyId) return res.status(400).json({ error: 'Department name and faculty are required' });
  const faculty = await db.get('SELECT id FROM faculties WHERE id = ?', facultyId);
  if (!faculty) return res.status(400).json({ error: 'Unknown faculty' });
  const info = await db.run(`INSERT INTO departments (name, faculty_id, kind) VALUES (?, ?, ?)
                            ON CONFLICT (name, faculty_id) DO NOTHING`, name.slice(0, 120), facultyId, kind);
  if (!info.changes) return res.status(409).json({ error: 'That department already exists in this faculty' });
  audit(req, 'masterdata.department.create', info.lastInsertRowid, { name, facultyId, kind });
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/admin/master-data/:kind/:id', requireAdmin, async (req, res) => {
  const { kind, id } = req.params;
  const active = req.body?.active;
  if (!['faculty', 'department', 'category'].includes(kind)) return res.status(400).json({ error: 'Unknown entity' });
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Provide { active: true|false }' });
  const table = { faculty: 'faculties', department: 'departments', category: 'ticket_categories' }[kind];
  await db.run(`UPDATE ${table} SET active = ? WHERE id = ?`, active ? 1 : 0, id);
  audit(req, `masterdata.${kind}.toggle`, id, { active });
  res.json({ ok: true });
});

/* ----------------------------- announcements ----------------------------- */

/** List every posted update (Super manages them from Settings → Updates). */
router.get('/admin/announcements', requireAdmin, async (_req, res) => {
  const rows = await db.all('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50');
  res.json({ announcements: rows });
});

router.post('/admin/announcements', requireAdmin, async (req, res) => {
  const kind = ['announcement', 'update', 'maintenance'].includes(req.body?.kind) ? req.body.kind : 'announcement';
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (title.length < 3 || title.length > 120) return res.status(400).json({ error: 'Title must be 3–120 characters.' });
  if (body.length < 3 || body.length > 600) return res.status(400).json({ error: 'Details must be 3–600 characters.' });
  const r = await db.run(
    'INSERT INTO announcements (kind, title, body, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)',
    kind, title, body, req.user.id, req.user.full_name
  );
  audit(req, 'announcement.create', r.lastInsertRowid, { kind, title });
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.delete('/admin/announcements/:id', requireAdmin, async (req, res) => {
  await db.run('DELETE FROM announcements WHERE id = ?', Number(req.params.id));
  audit(req, 'announcement.delete', Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
