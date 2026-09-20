import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../auth.jsx';

/**
 * Real-time chat thread over WebSocket — Messenger-style, no polling delay.
 *
 * mode 'student': the conversation behind a secret chat link token.
 * mode 'staff':   an inbox thread (message id) with the signed-in officer's JWT.
 *
 * The database stays the source of truth (REST still persists everything);
 * the socket PUSHES snapshots so both sides see messages, typing, "opened"
 * and "closed" instantly. If the socket drops, the hook falls back to the
 * old 4-second REST polling until it reconnects — nothing can get stuck.
 *
 * Returns { thread, live, send, sendTyping, close, setThread }.
 */
export function useLiveChat({ mode, token, messageId }) {
  const [thread, setThread] = useState(null);
  const [live, setLive] = useState(false);
  const wsRef = useRef(null);
  const aliveRef = useRef(true);
  const pollRef = useRef(null);
  const typingThrottle = useRef(0);

  const key = mode === 'student' ? `student:${token}` : `staff:${messageId}`;

  // Initial REST load — instant content even before the socket opens.
  useEffect(() => {
    aliveRef.current = true;
    setThread(null);
    if (mode === 'student') {
      fetch(`/api/chat/${token}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
        .then((d) => { if (aliveRef.current) setThread(d); }).catch(() => {});
    } else {
      api(`/staff/inbox/${messageId}/chat`).then((d) => { if (aliveRef.current) setThread(d); }).catch(() => {});
    }
    return () => { aliveRef.current = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket — one connection per open conversation.
  useEffect(() => {
    aliveRef.current = true;
    // Browsers cannot send an Authorization header on WebSocket, so the staff
    // JWT travels as the single Sec-WebSocket-Protocol entry (server reads it).
    const staffProto = mode === 'staff' && localStorage.getItem('rugipo.staff')
      ? [String(JSON.parse(localStorage.getItem('rugipo.staff')).token || '')]
      : [];
    const wsUrl = mode === 'student'
      ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/chat/${token}`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/staff/chat/${messageId}`;
    let closed = false;

    function connect() {
      if (closed || !aliveRef.current) return;
      let ws;
      try { ws = new WebSocket(wsUrl, staffProto); }
      catch { scheduleReconnect(); return; }
      wsRef.current = ws;

      ws.onopen = () => { setLive(true); startPolling(false); };
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === 'snapshot' && d.thread) setThread(d.thread);
          else if (d.type === 'closed') setThread((t) => (t ? { ...t, closed: true, messages: [] } : t));
          else if (d.type === 'opened') setThread((t) => (t ? { ...t, studentLastOpenedAt: d.at } : t));
          else if (d.type === 'typing') {
            if (mode === 'student') setThread((t) => (t ? { ...t, staffTyping: true } : t));
            else setThread((t) => (t ? { ...t, studentTyping: true } : t));
            // Typing bubbles self-expire; the next snapshot refreshes reality.
            setTimeout(() => setThread((t) => (t ? { ...t, [mode === 'student' ? 'staffTyping' : 'studentTyping']: false } : t)), 8000);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => { setLive(false); startPolling(true); scheduleReconnect(); };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    }

    // Fallback: while offline, keep the 4s REST poll so the chat still works.
    function startPolling(on) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (!on) return;
      pollRef.current = setInterval(() => {
        if (mode === 'student') {
          fetch(`/api/chat/${token}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setThread(d); }).catch(() => {});
        } else {
          api(`/staff/inbox/${messageId}/chat`).then(setThread).catch(() => {});
        }
      }, 4000);
    }
    let reconnectTimer = null;
    function scheduleReconnect() {
      if (closed) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2500);
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      if (pollRef.current) clearInterval(pollRef.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingThrottle.current < 2500) return;
    typingThrottle.current = now;
    try { wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify({ type: 'typing' })); } catch { /* ignore */ }
  }, []);

  const send = useCallback(async (body) => {
    const text = String(body || '').trim();
    if (!text) return;
    // Persist through REST (source of truth); the server then PUSHES the
    // snapshot over websocket to everyone — including us. We still refresh
    // right after the POST so the sender sees their own message even if the
    // socket is mid-reconnect.
    if (mode === 'student') {
      await fetch(`/api/chat/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      }).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not send'); });
      fetch(`/api/chat/${token}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setThread(d); }).catch(() => {});
    } else {
      await api(`/staff/inbox/${messageId}/chat`, { method: 'POST', body: JSON.stringify({ body: text }) });
      api(`/staff/inbox/${messageId}/chat`).then(setThread).catch(() => {});
    }
  }, [mode, token, messageId]);

  const close = useCallback(async () => {
    if (mode === 'student') {
      await fetch(`/api/chat/${token}/close`, { method: 'POST' });
      // The REST close now broadcasts, but refresh too so our own window
      // always flips to closed even offline.
      fetch(`/api/chat/${token}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setThread(d); }).catch(() => {});
    } else {
      await api(`/staff/inbox/${messageId}/close`, { method: 'POST' });
    }
    setThread((t) => (t ? { ...t, closed: true, messages: [] } : t));
  }, [mode, token, messageId]);

  return { thread, live, send, sendTyping, close, setThread };
}
