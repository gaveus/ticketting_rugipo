import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { api } from '../auth.jsx';

/**
 * Live chat transport — Messenger-style, no visible delay.
 *
 * The database stays the single source of truth: every message is persisted
 * through the normal REST endpoints. This hook only handles the *pushing* of
 * "something changed" so both sides see messages, typing and presence
 * instantly. Three transports, chosen automatically:
 *
 *   1. Supabase Realtime (broadcast channels) — used when VITE_SUPABASE_URL
 *      and VITE_SUPABASE_ANON_KEY are set. Works on any host, including
 *      serverless (Vercel), because the push comes from Supabase, not us.
 *   2. Our own WebSocket (/ws/...) — kept for local development.
 *   3. Quiet REST polling — the always-on safety net, so nothing can stall.
 *
 * Channel: `chat:msg:<conversationId>` — both sides know the id (the student
 * receives it in the initial load). Events: refresh | typing | opened | closed.
 *
 * mode 'student': the conversation behind a secret chat link token.
 * mode 'staff':   an inbox thread (message id) with the signed-in officer's JWT.
 *
 * Returns { thread, live, transport, send, sendTyping, close, setThread }.
 */

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supa = SUPA_URL && SUPA_KEY
  ? createClient(SUPA_URL, SUPA_KEY, { realtime: { params: { eventsPerSecond: 20 } } })
  : null;

const POLL_MS = 4000;      // last-resort poll while "offline"
const SAFETY_POLL_MS = 30000; // gentle backstop even when live

export function useLiveChat({ mode, token, messageId }) {
  const [thread, setThread] = useState(null);
  const [live, setLive] = useState(false);
  const [transport, setTransport] = useState(supa ? 'realtime' : 'connecting');
  const channelRef = useRef(null);
  const wsRef = useRef(null);
  const aliveRef = useRef(true);
  const pollRef = useRef(null);
  const typingThrottle = useRef(0);
  const lastRefresh = useRef(0);

  const key = mode === 'student' ? `student:${token}` : `staff:${messageId}`;

  /* --------------------------- data loaders --------------------------- */

  const fetchThread = useCallback(async () => {
    if (mode === 'student') {
      const r = await fetch(`/api/chat/${token}`);
      if (!r.ok) throw new Error('not found');
      return r.json();
    }
    return api(`/staff/inbox/${messageId}/chat`);
  }, [mode, token, messageId]);

  // Initial REST load — instant content even before the live channel opens.
  useEffect(() => {
    aliveRef.current = true;
    setThread(null);
    fetchThread().then((d) => { if (aliveRef.current) setThread(d); }).catch(() => {});
    return () => { aliveRef.current = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(async (minGapMs = 250) => {
    const now = Date.now();
    if (now - lastRefresh.current < minGapMs) return;
    lastRefresh.current = now;
    try {
      const d = await fetchThread();
      if (aliveRef.current && d) setThread(d);
    } catch { /* transient */ }
  }, [fetchThread]);

  /* ------------------------ transport 1: Supabase --------------------- */

  // The student learns the conversation id only after the first load, so the
  // channel key resolves asynchronously; staff knows it immediately.
  const chanKey = mode === 'staff' ? `msg:${messageId}` : (thread?.id ? `msg:${thread.id}` : null);

  useEffect(() => {
    if (!supa || !chanKey) return;
    aliveRef.current = true;
    let dead = false;

    const channel = supa.channel(`chat:${chanKey}`, { config: { broadcast: { self: false }, presence: { key: `${mode}-${chanKey}` } } });
    channelRef.current = channel;

    channel.on('broadcast', { event: 'refresh' }, () => { if (!dead) refetch(); });
    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (dead) return;
      const who = payload?.who;
      const mine = (mode === 'student' && who === 'student') || (mode === 'staff' && who === 'staff');
      if (mine) return;
      const field = mode === 'student' ? 'staffTyping' : 'studentTyping';
      setThread((t) => (t ? { ...t, [field]: true } : t));
      setTimeout(() => setThread((t) => (t ? { ...t, [field]: false } : t)), 8000);
    });
    channel.on('broadcast', { event: 'opened' }, ({ payload }) => {
      if (!dead && mode === 'staff') {
        setThread((t) => (t ? { ...t, studentLastOpenedAt: payload?.at || new Date().toISOString() } : t));
      }
    });
    channel.on('broadcast', { event: 'closed' }, () => {
      if (!dead) setThread((t) => (t ? { ...t, closed: true, messages: [] } : t));
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setLive(true);
        setTransport('realtime');
        startPolling('safety');
        // Anyone who joined earlier may have missed our "opened" moment.
        refetch(0);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setLive(false);
        startPolling('fast');
        setTransport('polling');
      }
    });

    startPolling('safety');
    return () => {
      dead = true;
      channelRef.current = null;
      try { supa.removeChannel(channel); } catch { /* ignore */ }
    };
  }, [chanKey && supa ? `chat:${chanKey}` : '']); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------ transport 2: our WS ----------------------- */

  useEffect(() => {
    if (supa) return; // Supabase handles the push when configured — no legacy socket
    aliveRef.current = true;
    const staffProto = mode === 'staff' && localStorage.getItem('rugipo.staff')
      ? [String(JSON.parse(localStorage.getItem('rugipo.staff')).token || '')]
      : [];
    const wsUrl = mode === 'student'
      ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/chat/${token}`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/staff/chat/${messageId}`;
    let closed = false;

    function startPollingLocal(on) {
      if (on) startPolling('fast');
    }

    function connect() {
      if (closed || !aliveRef.current) return;
      let ws;
      try { ws = new WebSocket(wsUrl, staffProto); }
      catch { startPollingLocal(true); return; }
      wsRef.current = ws;
      ws.onopen = () => { setLive(true); setTransport('websocket'); startPolling('safety'); };
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === 'snapshot' && d.thread) setThread(d.thread);
          else if (d.type === 'closed') setThread((t) => (t ? { ...t, closed: true, messages: [] } : t));
          else if (d.type === 'opened') setThread((t) => (t ? { ...t, studentLastOpenedAt: d.at } : t));
          else if (d.type === 'typing') {
            const field = mode === 'student' ? 'staffTyping' : 'studentTyping';
            setThread((t) => (t ? { ...t, [field]: true } : t));
            setTimeout(() => setThread((t) => (t ? { ...t, [field]: false } : t)), 8000);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => { setLive(false); setTransport('polling'); startPolling('fast'); };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    }

    connect();
    return () => {
      closed = true;
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------ polling (always-on net) ------------------- */

  const pollRef2 = useRef(null);
  function startPolling(kind) {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (pollRef2.current) { clearInterval(pollRef2.current); pollRef2.current = null; }
    if (kind === 'fast') {
      pollRef.current = setInterval(() => { if (aliveRef.current) refetch(0); }, POLL_MS);
    } else {
      pollRef2.current = setInterval(() => { if (aliveRef.current) refetch(0); }, SAFETY_POLL_MS);
    }
  }
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (pollRef2.current) clearInterval(pollRef2.current);
  }, []);

  /* ----------------------------- actions ------------------------------ */

  const bcast = useCallback((event, payload = {}) => {
    const ch = channelRef.current;
    if (ch) { ch.send({ type: 'broadcast', event, payload }).catch(() => {}); }
  }, []);

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingThrottle.current < 2500) return;
    typingThrottle.current = now;
    bcast('typing', { who: mode });
    // Persist typing for snapshot-based fallbacks (student side only — the
    // staff side persists it server-side through the legacy ws when present).
    if (mode === 'student' && !channelRef.current) {
      fetch(`/api/chat/${token}/typing`, { method: 'POST' }).catch(() => {});
    }
    try { wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify({ type: 'typing' })); } catch { /* ignore */ }
  }, [mode, token, bcast]);

  const send = useCallback(async (body) => {
    const text = String(body || '').trim();
    if (!text) return;
    if (mode === 'student') {
      await fetch(`/api/chat/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      }).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not send'); });
    } else {
      await api(`/staff/inbox/${messageId}/chat`, { method: 'POST', body: JSON.stringify({ body: text }) });
    }
    await refetch(0);   // the sender always sees their own message instantly
    bcast('refresh');   // everyone else refetches immediately
  }, [mode, token, messageId, refetch, bcast]);

  const close = useCallback(async () => {
    if (mode === 'student') await fetch(`/api/chat/${token}/close`, { method: 'POST' });
    else await api(`/staff/inbox/${messageId}/close`, { method: 'POST' });
    bcast('closed');
    bcast('refresh');
    await refetch(0);
    setThread((t) => (t ? { ...t, closed: true, messages: [] } : t));
  }, [mode, token, messageId, refetch, bcast]);

  return { thread, live, transport, send, sendTyping, close, setThread };
}
