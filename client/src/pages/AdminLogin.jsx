import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../auth.jsx';

/**
 * /admin — the hidden staff gate. Students never see this (no public link,
 * no self-registration — accounts are created by the Super ICT Support).
 */
export default function AdminLogin() {
  const { user, ready, signIn } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [login, setLogin] = useState({ email: '', password: '' });

  useEffect(() => { if (ready && user) nav('/admin/dashboard', { replace: true }); }, [ready, user]);

  async function doSignIn(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const d = await api('/auth/login', { method: 'POST', body: JSON.stringify(login) });
      signIn(d.token, d.user);
      nav('/admin/dashboard');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <section className="section container" style={{ maxWidth: 460 }}>
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <img src="/rugipo-logo.png" alt="" style={{ width: 54, height: 54, borderRadius: '50%', background: '#fff', padding: 3, border: '2px solid var(--gold)' }} />
          <h1 className="section__title" style={{ marginTop: 10 }}>ICT Staff Portal</h1>
          <p className="section__sub" style={{ marginBottom: 0 }}>
            Authorized personnel only. Accounts are issued by the Super ICT Support.
          </p>
        </div>

        {error && <div className="notice notice--err">{error}</div>}

        <form onSubmit={doSignIn}>
          <label className="field"><span>Official email</span>
            <input type="email" value={login.email} autoComplete="username" required
              onChange={(e) => setLogin({ ...login, email: e.target.value })} />
          </label>
          <label className="field"><span>Password</span>
            <input type="password" value={login.password} autoComplete="current-password" required
              onChange={(e) => setLogin({ ...login, password: e.target.value })} />
          </label>
          <button className="btn btn--navy" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in to portal'}
          </button>
        </form>
        <p className="muted" style={{ fontSize: '.8rem', marginTop: 12, textAlign: 'center' }}>
          Need an account? Contact the Super ICT Support administrator.
        </p>
      </div>
    </section>
  );
}
