import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDateTime, fmtDate } from '../auth.jsx';
import { Mail, Search } from 'lucide-react';
import TicketView from '../components/TicketView.jsx';

const STATUS_FLOW = [
  ['open', 'Received', 'We have your complaint and it is in the queue.'],
  ['in_progress', 'Being worked on', 'An ICT officer is actively on it.'],
  ['escalated', 'Senior review', 'A Senior Engineer is handling it personally.'],
  ['resolved', 'Solved', 'It is fixed — we have emailed you the details.'],
];

/** Lost your Tracking ID, or the private chat link never arrived? Re-send them. */
function ResendHelpers({ email }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function resend(kind) {
    setBusy(kind); setMsg('');
    try {
      await api('/recover', { method: 'POST', body: JSON.stringify({ kind, email }) });
      setMsg(kind === 'chat'
        ? `Sent — every active conversation link for ${email} has been re-emailed.`
        : `Sent — your Tracking IDs have been re-emailed to ${email}.`);
    } catch (e) { setMsg(e.message); }
    finally { setBusy(''); }
  }

  return (
    <div>
      <strong style={{ fontSize: '.9rem' }}>Lost something?</strong>
      <p className="muted" style={{ fontSize: '.84rem', margin: '4px 0 8px' }}>
        Enter the email you used when logging the complaint above, then:
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--outline btn--sm" disabled={!!busy || !email}
          onClick={() => resend('ids')}>
          {busy === 'ids' ? 'Sending…' : <><Mail size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Re-send my Tracking ID</>}
        </button>
        <button type="button" className="btn btn--outline btn--sm" disabled={!!busy || !email}
          onClick={() => resend('chat')}>
          {busy === 'chat' ? 'Sending…' : <><Mail size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Re-send my chat link</>}
        </button>
      </div>
      {msg && <p className="muted" style={{ fontSize: '.84rem', margin: '8px 0 0' }}>{msg}</p>}
    </div>
  );
}

export default function Track() {
  const nav = useNavigate();
  // Homepage widget deep-links here with ?number=&email= — prefill and auto-open.
  const [params] = useSearchParams();
  const [number, setNumber] = useState(params.get('number') || '');
  const [email, setEmail] = useState(params.get('email') || '');
  const [ticketId, setTicketId] = useState(null);
  const [quick, setQuick] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const autoRan = useRef(false);

  async function submit(e) {
    if (e) e.preventDefault();
    setError(''); setQuick(null); setTicketId(null); setBusy(true);
    try {
      const d = await api('/tickets/track', {
        method: 'POST',
        body: JSON.stringify({ ticketNumber: number.trim(), email: email.trim() }),
      });
      setTicketId(d.ticketId);
    } catch (err) {
      // fall back to the public limited lookup (status only, works even without email match shape issues)
      try {
        const q = await api(`/track/${encodeURIComponent(number.trim().toUpperCase())}`);
        setQuick(q);
        setError(`That email does not match this ticket. Check for typing mistakes — the ticket is registered to a different address. Showing public status only (ID ${q.ticketNumber}).`);
      } catch {
        setError('No ticket matches that Tracking ID. Double-check the ID — it looks like RGP-2026-A0001 and was shown when the complaint was submitted and emailed to you.');
      }
    } finally { setBusy(false); }
  }

  // Arriving from the homepage widget with both values? Track immediately.
  useEffect(() => {
    if (autoRan.current) return;
    const n = params.get('number'), e = params.get('email');
    if (n && e) { autoRan.current = true; submit(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="section container" style={{ maxWidth: 800 }}>
      {/* ------------------------- page hero ------------------------- */}
      <div className="track-hero mb">
        <span className="hero__badge">Complaint tracker</span>
        <h1 className="section__title" style={{ margin: '10px 0 4px', fontSize: '1.7rem' }}>
          Where does my complaint stand?
        </h1>
        <p className="section__sub" style={{ marginBottom: 0 }}>
          Enter your Tracking ID and <strong>the exact email you used when logging the complaint</strong> —
          both must match. The ID is not case-sensitive, and a copy was sent to that email.
        </p>
      </div>

      <div className="card mb">
        {error && <div className="notice notice--err">{error}</div>}
        <form onSubmit={submit} className="track-form">
          <div className="track-form__fields">
            <label className="field"><span>Tracking ID</span>
              <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="RGP-2026-A0001" required />
            </label>
            <label className="field"><span>Your email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
            </label>
          </div>
          <button className="btn btn--navy" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Checking…' : <><Search size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Track my complaint</>}
          </button>
        </form>

        {quick && (
          <div className="notice notice--info mt">
            <strong>{quick.ticketNumber}</strong> — {quick.category} · {quick.issue}
            <br />Status: <span className={`badge badge--${quick.status}`}>{quick.status.replace('_', ' ')}</span>
            <br />Last update: {fmtDateTime(quick.updatedAt)}
          </div>
        )}
      </div>

      {/* -------- what the stages mean — shown before and after lookup -------- */}
      {!ticketId && (
        <div className="card mb track-stages">
          <strong>What each stage means</strong>
          <ol className="steps-flow steps-flow--compact">
            {STATUS_FLOW.map(([key, title, desc]) => (
              <li key={key}>
                <span className="steps-flow__num">{title[0]}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="muted" style={{ fontSize: '.84rem', margin: '6px 0 0' }}>
            First time here? <Link to="/new-ticket">Log a complaint</Link> — it takes less than a minute and you'll get a Tracking ID instantly.
          </p>
          <div className="divider" />
          <ResendHelpers email={email.trim()} />
        </div>
      )}

      {ticketId && <TicketView ticketId={ticketId} email={email.trim()} />}
    </section>
  );
}
