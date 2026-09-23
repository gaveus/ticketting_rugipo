import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../auth.jsx';

/**
 * Idle auto-lock for the staff portal.
 *
 * When an officer signs in and then walks away — no clicks, no keys, no
 * scrolling for 15 minutes — the screen locks and their work is hidden until
 * they type their password again. Nothing is signed out and nothing is lost:
 * unlocking simply re-proves it is really them at the keyboard.
 *
 * Why this matters: an unattended dashboard in an open office is an open door.
 * Anyone could walk past and act as that officer. This closes it.
 */

const LOCK_MS = 15 * 60 * 1000;   // 15 quiet minutes → lock
const WARN_MS = LOCK_MS - 60_000; // warn one minute before

const ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

export default function IdleLock() {
  const [locked, setLocked] = useState(false);
  const [warning, setWarning] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastActivity = useRef(Date.now());
  const inputRef = useRef(null);

  const lock = useCallback(() => {
    setWarning(false);
    setLocked(true);
    setPassword('');
    setError('');
  }, []);

  useEffect(() => {
    let raf = null;
    function touch() { lastActivity.current = Date.now(); }
    ACTIVITY.forEach((ev) => document.addEventListener(ev, touch, { passive: true }));

    function check() {
      const quiet = Date.now() - lastActivity.current;
      if (quiet >= LOCK_MS) lock();
      else if (quiet >= WARN_MS) setWarning(true);
    }
    const t = setInterval(check, 5000);
    return () => {
      ACTIVITY.forEach((ev) => document.removeEventListener(ev, touch));
      clearInterval(t);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [lock]);

  // Focus the password box the moment the lock appears.
  useEffect(() => { if (locked && inputRef.current) inputRef.current.focus(); }, [locked]);

  async function unlock(e) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/auth/unlock', { method: 'POST', body: JSON.stringify({ password }) });
      lastActivity.current = Date.now();
      setLocked(false);
      setPassword('');
    } catch (err) {
      setError(err.message || 'That password is not correct');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {warning && !locked && (
        <div className="idlebar" role="status">
          <span className="idlebar__dot" aria-hidden="true" />
          Still there? For your safety this screen will lock in about a minute of inactivity.
        </div>
      )}

      {locked && (
        <div className="idlelock" role="dialog" aria-modal="true" aria-label="Screen locked">
          <div className="idlelock__veil" aria-hidden="true" />
          <form className="idlelock__card" onSubmit={unlock}>
            <img src="/rugipo-logo.png" alt="" className="idlelock__logo" />
            <h1>Screen locked</h1>
            <p>
              We locked this screen after a period of inactivity to protect student
              information. Enter your password to continue where you left off.
            </p>
            <label className="idlelock__label" htmlFor="idlelock-pass">Your password</label>
            <input
              id="idlelock-pass"
              ref={inputRef}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="Enter your password"
              disabled={busy}
            />
            {error && <div className="idlelock__error" role="alert">{error}</div>}
            <button className="idlelock__btn" type="submit" disabled={busy || !password}>
              {busy ? 'Checking…' : 'Unlock screen'}
            </button>
            <small className="idlelock__hint">Locked because there was no activity for 15 minutes.</small>
          </form>
        </div>
      )}
    </>
  );
}
