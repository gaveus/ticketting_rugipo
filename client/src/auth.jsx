import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);
const KEY = 'rugipo.staff';

export function api(path, options = {}) {
  const raw = localStorage.getItem(KEY);
  const token = raw ? JSON.parse(raw).token : null;
  return fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  }).then(async (r) => {
    // A 401 here means the session truly expired — clear the stale session so
    // the next navigation shows the sign-in gate instead of silent failures.
    if (r.status === 401 && !path.startsWith('/auth/login')) {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
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
