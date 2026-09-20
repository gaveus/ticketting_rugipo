import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../auth.jsx';

/**
 * Reach ICT — for questions, clarifications and anything that is not (yet) a
 * complaint. Complaints still go through "Log a Complaint" so they get a
 * Tracking ID and full tracking.
 */
export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', matricNo: '', subject: '', message: '' });
  const [honey, setHoney] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [chatUrl, setChatUrl] = useState('');
  const [error, setError] = useState('');

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const d = await api('/contact', { method: 'POST', body: JSON.stringify({ ...form, website: honey }) });
      setChatUrl(d.chatUrl || '');
      setDone(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="section container" style={{ maxWidth: 720 }}>
      <h1 className="section__title">Talk to ICT Support</h1>
      <p className="section__sub">
        A question, a clarification, or something you want to ask before logging a complaint?
        Send it here — a real person reads every message and replies to your email.
      </p>

      {done ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem' }}>📨</div>
          <h2 className="section__title">Message sent</h2>
          <p className="section__sub">
            We've sent a confirmation to <strong>{form.email}</strong>. A member of the ICT team
            will reply to you there — usually within one working day.
          </p>
          {chatUrl && (
            <div className="notice notice--info" style={{ textAlign: 'left' }}>
              <strong>Want to talk live?</strong> Your private chat room is open — the same link is in
              your email. <Link to={chatUrl}>Open the conversation now →</Link>
            </div>
 )}
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn btn--navy" to="/new-ticket">Log a complaint instead →</Link>
            <Link className="btn btn--outline" to="/">Back to home</Link>
          </div>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          {error && <div className="notice notice--err">{error}</div>}
          {/* Honeypot — visually hidden; bots that fill it are rejected. */}
          <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }} aria-hidden="true">
            <label>Leave this field empty<input tabIndex={-1} autoComplete="off" value={honey}
              onChange={(e) => setHoney(e.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label className="field"><span>Your name</span>
              <input value={form.name} required maxLength={120}
                onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="field"><span>Email address <small>(our reply goes here)</small></span>
              <input type="email" value={form.email} required
                onChange={(e) => set('email', e.target.value)} />
            </label>
            <label className="field"><span>Phone number <small>(optional)</small></span>
              <input value={form.phone} maxLength={30}
                onChange={(e) => set('phone', e.target.value)} />
            </label>
            <label className="field"><span>Matric number <small>(optional)</small></span>
              <input value={form.matricNo} maxLength={60}
                onChange={(e) => set('matricNo', e.target.value)} />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>What is it about?</span>
              <input value={form.subject} required maxLength={160}
                placeholder="One line — e.g. Is the portal down right now?" 
                onChange={(e) => set('subject', e.target.value)} />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Your message</span>
              <textarea rows={5} value={form.message} required minLength={10} maxLength={4000}
                placeholder="Write it the way you'd say it — plain language is fine."
                onChange={(e) => set('message', e.target.value)} />
            </label>
          </div>

          <div className="notice notice--info">
            Is this a <strong>complaint about a portal, payment or registration problem</strong>?
            Use <Link to="/new-ticket">Log a Complaint</Link> instead — you'll get a Tracking ID
            and we'll see it through until it's solved.
          </div>

          <div className="row mt" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>
              We only use your details to answer you — nothing else.
            </p>
            <button className="btn btn--navy" disabled={busy}>
              {busy ? 'Sending…' : 'Send message'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
