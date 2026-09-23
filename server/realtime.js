/**
 * Server-side push over Supabase Realtime (broadcast channels).
 *
 * When SUPABASE_URL + SUPABASE_SERVICE_KEY are set, every chat event that the
 * REST routes persist is also broadcast here, so the other side sees it
 * instantly — on any host, including serverless (Vercel), where we cannot run
 * our own websocket server. Without these variables everything still works:
 * the local websocket fanout and the client's polling keep chat live.
 *
 * Channels and events mirror the client (client/src/hooks/useLiveChat.js):
 *   channel "chat:msg:<id>"  events: refresh | typing | opened | closed
 *   channel "inbox:badges"   event:  refresh  (unread count changed)
 */
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

let admin = null;
if (URL && KEY) {
  admin = createClient(URL, KEY, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 20 } } });
  console.log('[realtime] Supabase broadcast enabled');
} else {
  console.log('[realtime] Supabase not configured — chat pushes via local websocket / polling');
}

/** Fire-and-forget broadcast; never throws into the request path. */
function bcast(channel, event, payload = {}) {
  if (!admin) return;
  try {
    const ch = admin.channel(channel);
    ch.send({ type: 'broadcast', event, payload })
      .catch(() => {})
      .finally(() => { try { admin.removeChannel(ch); } catch { /* ignore */ } });
  } catch { /* ignore */ }
}

module.exports = {
  enabled: !!admin,
  /** Both sides of conversation <id> should refetch. */
  chatRefresh: (id) => bcast(`chat:msg:${id}`, 'refresh'),
  /** One side is typing (who: 'student' | 'staff'). */
  chatTyping: (id, who) => bcast(`chat:msg:${id}`, 'typing', { who }),
  /** The student opened the conversation (staff side shows it). */
  chatOpened: (id, at) => bcast(`chat:msg:${id}`, 'opened', { at }),
  /** The conversation was closed — history deleted. */
  chatClosed: (id) => bcast(`chat:msg:${id}`, 'closed'),
  /** The inbox unread badge changed for every officer. */
  inboxBadge: () => bcast('inbox:badges', 'refresh'),
};
