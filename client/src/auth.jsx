import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);
const KEY = 'rugipo.staff';

/**
 * §6/§39 — every technical failure becomes one honest, human sentence.
 * No status codes, no routes, no stack traces, no server internals.
 */
export function humanizeError(status, serverMessage) {
  if (serverMessage && !/[(){}]|\bapi\b|\bsql\b|\bjwt\b|status \d/i.test(serverMessage)) return serverMessage;
  switch (status) {
    case 400: return 'Please check the information you entered and try again.';
    case 401: return 'Your session has ended. Please sign in again.';
    case 403: return 'You do not have permission to do that.';
    case 404: return 'We could not find what you were looking for. It may have been removed.';
    case 409: return 'That already exists — check for a duplicate before trying again.';
    case 422: return 'Some details need correcting before this can be saved.';
    case 429: return 'Too many attempts too quickly. Please wait a moment and try again.';
    case 502: case 504: return 'The service is temporarily unreachable. Please try again in a moment.';
    case 503: return 'The service is busy right now. Please try again in a moment.';
    default: return 'Something went wrong while processing your request. Please try again. If the problem continues, contact ICT Support.';
  }
}

export function api(path, options = {}) {
  const raw = localStorage.getItem(KEY);
  const token = raw ? JSON.parse(raw).token : null;
  // Reads (GET) are safe to fire twice — never once show "busy" for a load
  // that a quiet second attempt would have satisfied. Writes are retried on
  // the server's own transient-retry layer instead, so no double-submit risk.
  const isGet = !options.method || options.method === 'GET';
  async function attemptOnce() {
    const r = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    // A 401 here means the session truly expired — clear the stale session so
    // the next navigation shows the sign-in gate instead of silent failures.
    if (r.status === 401 && !path.startsWith('/auth/login')) {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(humanizeError(r.status, data.error));
      err.status = r.status;
      throw err;
    }
    return data;
  }
  const attempt = (async () => {
    if (!isGet) return attemptOnce();
    for (let i = 1; ; i++) {
      try {
        return await attemptOnce();
      } catch (e) {
        const retryable = [502, 503, 504].includes(e.status) || (e instanceof TypeError);
        if (!retryable || i >= 2) throw e;
        await new Promise((res) => setTimeout(res, 700));
      }
    }
  })();
  // A dead network must not produce a raw "Failed to fetch" — say it in words.
  return attempt.catch((e) => {
    if (e instanceof TypeError && !navigator.onLine) throw new Error('You appear to be offline. Please check your internet connection and try again.');
    if (e instanceof TypeError) throw new Error('We could not reach the ICT Support system. Please check your connection and try again.');
    throw e;
  });
}

/** File-upload variant (multipart). */
export function apiUpload(path, formData, email) {
  const raw = localStorage.getItem(KEY);
  const token = raw ? JSON.parse(raw).token : null;
  if (email) formData.append('email', email);
  return fetch(`/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  }).then(async (r) => {
    if (r.status === 401) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Upload failed (${r.status})`);
    return data;
  });
}

/**
 * Attachment download. Students pass their email (ownership proof);
 * staff downloads are proxied through the staff marker.
 */
export function downloadAttachment(id, email) {
  const raw = localStorage.getItem(KEY);
  const token = raw ? JSON.parse(raw).token : null;
  const url = email
    ? `/api/attachments/${id}?email=${encodeURIComponent(email)}`
    : `/api/attachments/${id}`;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(async (r) => {
    if (!r.ok) throw new Error('Could not load the file');
    const type = r.headers.get('content-type') || '';
    // Cloudinary-stored files come back as { url } — open them directly.
    if (type.includes('application/json')) {
      const data = await r.json();
      if (data.url) window.open(data.url, '_blank', 'noopener');
      return;
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let token = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); token = s.token; setUser(s.user); }
    } catch { /* ignore */ }
    setReady(true);
    // Heal a stale stored profile: the server is the truth for details like
    // the profile photo, so re-fetch once on load when we hold a token.
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => { if (d?.user) updateUser(d.user); })
        .catch(() => { /* offline or expired — the stored user still works */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn(token, user) {
    localStorage.setItem(KEY, JSON.stringify({ token, user }));
    setUser(user);
  }
  /** Patch the signed-in user (profile edits, photo) in memory AND storage. */
  function updateUser(patch) {
    setUser((u) => {
      const next = { ...(u || {}), ...patch };
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const session = JSON.parse(raw);
          session.user = next;
          localStorage.setItem(KEY, JSON.stringify(session));
        }
      } catch { /* ignore */ }
      return next;
    });
  }
  function signOut() {
    localStorage.removeItem(KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, ready, signIn, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Format an API timestamp — always in Nigeria time (WAT, UTC+1). */
export function fmtDateTime(v) {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Date-only variant (Nigeria time). */
export function fmtDate(v) {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Nigeria-clock greeting — the whole school runs on Lagos time. */
export function nigeriaGreeting() {
  const h = Number(new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', hour12: false }).format(new Date()));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
