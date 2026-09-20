/**
 * WebSocket layer — instant chat for the RUGIPO ICT portal (no polling delay).
 *
 * Why: the database is already the single source of truth (every message,
 * typing ping and close is persisted by the REST routes). This hub simply
 * PUSHES those events to everyone viewing the same conversation the moment
 * they happen. HTTP endpoints keep working exactly as before — this is an
 * upgrade, not a replacement.
 *
 * Channels:
 *   /ws/chat/<token>            → the student's side (holds the secret chat link)
 *   /ws/staff/chat/<messageId>  → staff side (JWT in the Sec-WebSocket-Protocol header)
 *   /ws/staff/inbox             → live unread badge for every signed-in officer
 *
 * Client → server messages (JSON):
 *   { type: 'typing' }                 → presence ping (persisted, then fanned out)
 *   { type: 'message', body: '…' }     → convenience send (same persistence as POST)
 *   { type: 'ping' } / { type: 'pong' }→ keepalive
 *
 * Server → client messages (JSON):
 *   { type: 'message', message } | { type: 'typing', who } |
 *   { type: 'opened', at } | { type: 'closed' } | { type: 'inbox', unread }
 */
const { WebSocketServer } = require('ws');
const { db } = require('./db');
const jwt = require('jsonwebtoken');
const url = require('url');

/** All sockets watching a conversation, keyed by messageId. */
const staffRooms = new Map(); // messageId → Set<ws>
const studentRooms = new Map(); // token → Set<ws>

function safeSend(ws, obj) {
  try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* closing */ }
}

function broadcast(room, obj, except) {
  for (const ws of room) if (ws !== except) safeSend(ws, obj);
}

function joinRoom(map, key, ws) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(ws);
  ws._room = { map, key };
}

function leaveRoom(ws) {
  if (!ws._room) return;
  const set = ws._room.map.get(ws._room.key);
  if (set) { set.delete(ws); if (set.size === 0) ws._room.map.delete(ws._room.key); }
  ws._room = null;
}

/** Clean a chat body the same way the REST route does. */
function cleanChatBody(v, max = 4000) {
  return String(v ?? '')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** Everything both sides need about one conversation, in REST shapes. */
async function snapshotForStudent(token) {
  const m = await db.get('SELECT * FROM contact_messages WHERE chat_token = ?', token);
  if (!m) return null;
  const messages = m.closed_at ? [] : await db.all(
    'SELECT id, sender, sender_name, body, created_at FROM chat_messages WHERE message_id = ? ORDER BY created_at, id', m.id);
  return {
    subject: m.subject, studentName: m.sender_name, closed: !!m.closed_at,
    closedAt: m.closed_at, messages, staffTyping: false, staffSeenAt: m.staff_seen_at || null,
  };
}

async function snapshotForStaff(messageId) {
  const m = await db.get('SELECT * FROM contact_messages WHERE id = ?', messageId);
  if (!m) return null;
  const messages = m.closed_at ? [] : await db.all(
    'SELECT id, sender, sender_name, body, created_at FROM chat_messages WHERE message_id = ? ORDER BY created_at, id', m.id);
  const typing = m.student_typing_at && (Date.now() - new Date(m.student_typing_at).getTime()) < 8000;
  return {
    id: m.id, subject: m.subject, studentName: m.sender_name, email: m.email,
    status: m.status, closed: !!m.closed_at, messages,
    studentTyping: !!typing, studentLastOpenedAt: m.student_opened_at || null,
  };
}

async function unreadCount() {
  const r = await db.get(`SELECT COUNT(*)::int AS n FROM contact_messages WHERE closed_at IS NULL AND status = 'new'`);
  return r.n;
}

/** Staff identity from the Sec-WebSocket-Protocol header (browser WS cannot set Authorization). */
function verifyStaff(req) {
  const header = req.headers['sec-websocket-protocol'] || '';
  const token = header.split(',')[0]?.trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || '');
    return payload && payload.sub ? { id: payload.sub, role: payload.role } : null;
  } catch {
    return null;
  }
}

function handleTypingStudent(token) {
  return db.run('UPDATE contact_messages SET student_typing_at = now() WHERE chat_token = ?', token)
    .then(async () => {
      const m = await db.get('SELECT id FROM contact_messages WHERE chat_token = ?', token);
      if (!m) return;
      broadcast(staffRooms.get(m.id) || new Set(), { type: 'typing', who: 'student' });
    })
    .catch(() => {});
}

function handleTypingStaff(messageId) {
  return db.run('UPDATE contact_messages SET staff_typing_at = now() WHERE id = ?', messageId)
    .then(() => {
      const rooms = studentRoomsByMessage(messageId);
      for (const room of rooms) broadcast(room, { type: 'typing', who: 'staff' });
    })
    .catch(() => {});
}

/** All student rooms belonging to one conversation (keyed by token). */
async function studentRoomsByMessage(messageId) {
  const m = await db.get('SELECT chat_token FROM contact_messages WHERE id = ?', messageId);
  const room = m?.chat_token ? studentRooms.get(m.chat_token) : null;
  return room ? [room] : [];
}

async function fanoutStaffSnapshot(messageId) {
  const snap = await snapshotForStaff(messageId);
  const room = staffRooms.get(messageId);
  if (room && snap) broadcast(room, { type: 'snapshot', thread: snap });
  return snap;
}

async function fanoutStudentSnapshot(token) {
  const snap = await snapshotForStudent(token);
  const room = studentRooms.get(token);
  if (room && snap) broadcast(room, { type: 'snapshot', thread: snap });
  return snap;
}

function setupChatWebsockets(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req, socket, head) => {
    const path = (url.parse(req.url).pathname || '');
    try {
      if (path.startsWith('/ws/chat/')) {
        const token = path.slice('/ws/chat/'.length);
        const m = await db.get('SELECT id FROM contact_messages WHERE chat_token = ?', token);
        if (!m) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => {
          // Opening the socket means the student opened the conversation.
          db.run('UPDATE contact_messages SET student_opened_at = now() WHERE id = ?', m.id)
            .then(async () => {
              for (const room of [staffRooms.get(m.id)].filter(Boolean)) {
                broadcast(room, { type: 'opened', at: new Date().toISOString() });
              }
            })
            .catch(() => {});
          joinRoom(studentRooms, token, ws);
          snapshotForStudent(token).then((snap) => safeSend(ws, { type: 'snapshot', thread: snap }));
          ws.on('message', (raw) => onStudentMessage(token, m.id, ws, raw));
          ws.on('close', () => leaveRoom(ws));
        });
      } else if (path.startsWith('/ws/staff/chat/')) {
        const user = verifyStaff(req);
        if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
        const messageId = Number(path.slice('/ws/staff/chat/'.length));
        const m = await db.get('SELECT id FROM contact_messages WHERE id = ?', messageId);
        if (!m) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => {
          db.run('UPDATE contact_messages SET staff_seen_at = now() WHERE id = ?', m.id).catch(() => {});
          joinRoom(staffRooms, messageId, ws);
          snapshotForStaff(messageId).then((s) => safeSend(ws, { type: 'snapshot', thread: s }));
          ws.on('message', (raw) => onStaffMessage(messageId, user, ws, raw));
          ws.on('close', () => leaveRoom(ws));
        });
      } else if (path === '/ws/staff/inbox') {
        const user = verifyStaff(req);
        if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws._inbox = true;
          unreadCount().then((n) => safeSend(ws, { type: 'inbox', unread: n })).catch(() => {});
          ws.on('message', (raw) => {
            try {
              const d = JSON.parse(raw.toString());
              if (d.type === 'ping') safeSend(ws, { type: 'pong' });
            } catch { /* ignore */ }
          });
          ws.on('close', () => { ws._inbox = false; });
        });
      } else {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
      }
    } catch (e) {
      try { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); } catch { /* ignore */ }
    }
  });

  /* --------------------- inbound student events --------------------- */

  async function onStudentMessage(token, messageId, ws, raw) {
    let d = {};
    try { d = JSON.parse(raw.toString()); } catch { return; }
    if (d.type === 'ping') return safeSend(ws, { type: 'pong' });
    if (d.type === 'typing') return handleTypingStudent(token);
    if (d.type === 'message') {
      const body = cleanChatBody(d.body);
      if (body.length < 2) return;
      const m = await db.get('SELECT * FROM contact_messages WHERE chat_token = ?', token);
      if (!m || m.closed_at) return;
      await db.run(`INSERT INTO chat_messages (message_id, sender, sender_name, body) VALUES (?, 'student', ?, ?)`,
        m.id, m.sender_name, body);
      await fanoutStaffSnapshot(m.id);
      await fanoutStudentSnapshot(token);
      // The inbox badge changes for every officer when a new question arrives.
      fanoutInbox();
    }
  }

  /* ---------------------- inbound staff events ---------------------- */

  async function onStaffMessage(messageId, user, ws, raw) {
    let d = {};
    try { d = JSON.parse(raw.toString()); } catch { return; }
    if (d.type === 'ping') return safeSend(ws, { type: 'pong' });
    if (d.type === 'typing') return handleTypingStaff(messageId);
    if (d.type === 'message') {
      const body = cleanChatBody(d.body);
      if (body.length < 2) return;
      const m = await db.get('SELECT * FROM contact_messages WHERE id = ?', messageId);
      if (!m || m.closed_at) return;
      await db.run(`INSERT INTO chat_messages (message_id, sender, sender_name, body) VALUES (?, 'staff', ?, ?)`,
        m.id, user.fullName || 'ICT Support', body);
      await db.run(`UPDATE contact_messages SET replied_by = ?, replied_by_name = ?, replied_at = now(), status = 'answered',
         staff_seen_at = now() WHERE id = ? AND replied_by IS NULL`, user.id, user.fullName || 'ICT Support', m.id);
      await fanoutStaffSnapshot(m.id);
      await fanoutStudentSnapshot(m.chat_token);
      fanoutInbox();
    }
    if (d.type === 'close') {
      const m = await db.get('SELECT id, chat_token FROM contact_messages WHERE id = ?', messageId);
      if (!m) return;
      await db.run('DELETE FROM chat_messages WHERE message_id = ?', m.id);
      await db.run(`UPDATE contact_messages SET closed_at = now(), status = 'closed',
         message = '(conversation closed — history removed)', staff_reply = NULL WHERE id = ?`, m.id);
      const staffRoom = staffRooms.get(m.id);
      if (staffRoom) broadcast(staffRoom, { type: 'closed' });
      const studentRoom = m.chat_token ? studentRooms.get(m.chat_token) : null;
      if (studentRoom) broadcast(studentRoom, { type: 'closed' });
      fanoutInbox();
    }
  }

  /** Push the live unread count to every connected officer's badge. */
  async function fanoutInbox() {
    const n = await unreadCount().catch(() => null);
    if (n == null) return;
    wss.clients.forEach((ws) => { if (ws._inbox) safeSend(ws, { type: 'inbox', unread: n }); });
  }
  // Expose for the REST routes: whenever an HTTP endpoint persists a chat
  // event (send, reply, close), it calls these so every connected viewer
  // — including the other side — sees it instantly, exactly like the socket
  // handlers do. The DB stays the single source of truth.
  setupChatWebsockets.fanoutInbox = fanoutInbox;
  setupChatWebsockets.fanoutStudentSnapshot = fanoutStudentSnapshot;
  setupChatWebsockets.fanoutStaffSnapshot = fanoutStaffSnapshot;
  setupChatWebsockets.broadcastStudentClosed = async (token) => {
    if (!token) return;
    const room = studentRooms.get(token);
    if (room) broadcast(room, { type: 'closed' });
  };
  setupChatWebsockets.broadcastStaffClosed = async (messageId) => {
    const room = staffRooms.get(messageId);
    if (room) broadcast(room, { type: 'closed' });
  };

  console.log('[ws] chat websockets ready (/ws/chat/<token>, /ws/staff/chat/<id>, /ws/staff/inbox)');
  return wss;
}

module.exports = { setupChatWebsockets };
