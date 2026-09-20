import React, { useEffect, useState } from 'react';
import { api, downloadAttachment, fmtDateTime } from '../auth.jsx';
import { STATUS_LABELS } from './Layout.jsx';

/** The journey every complaint walks — the student's progress bar follows it. */
const STAGES = [
  { key: 'received', label: 'Received', statuses: ['open', 'assigned'] },
  { key: 'work', label: 'Being worked on', statuses: ['in_progress', 'waiting_student'] },
  { key: 'senior', label: 'Senior review', statuses: ['escalated'] },
  { key: 'solved', label: 'Solved', statuses: ['resolved', 'closed'] },
];

function stageIndex(status) {
  if (status === 'rejected') return -1;
  const i = STAGES.findIndex((s) => s.statuses.includes(status));
  return i === -1 ? 0 : i;
}

/** Full ticket view for students (looked up by Tracking ID + email). */
export default function TicketView({ ticketId, email }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api(`/tickets/${ticketId}?email=${encodeURIComponent(email)}`)
      .then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => { if (ticketId && email) load(); }, [ticketId, email]);
  // Near-live chat: refresh the conversation every 10 seconds while open.
  useEffect(() => {
    if (!ticketId || !email) return;
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, email]);

  if (error) return <div className="notice notice--err">{error}</div>;
  if (!data) return (
    <div className="page-loading" role="status">
      <span className="page-loading__spinner" aria-hidden="true" />
      <strong>Please hold on while we fetch your details…</strong>
      <small>Getting your complaint, messages and progress — almost there.</small>
    </div>
  );

  const { ticket, messages, attachments, payment, history } = data;
  const active = stageIndex(ticket.status);
  const rejected = ticket.status === 'rejected';

  async function sendReply(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api(`/tickets/${ticketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ email, message: reply }),
      });
      setReply('');
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div>
      {/* ------------------------- ticket header ------------------------- */}
      <div className="card mb">
        <div className="row row--between" style={{ flexWrap: 'wrap' }}>
          <div>
            <h2 className="section__title" style={{ marginBottom: 2 }}>{ticket.ticketNumber}</h2>
            <span className={`badge badge--${ticket.status}`}>{STATUS_LABELS[ticket.status]}</span>{' '}
            <span className="muted" style={{ fontSize: '.88rem' }}>{ticket.category} · {ticket.issue}</span>
          </div>
          <span className="muted" style={{ fontSize: '.8rem' }}>Submitted {fmtDateTime(ticket.createdAt)}</span>
        </div>
        <p style={{ whiteSpace: 'pre-wrap' }} className="mt">{ticket.description}</p>
      </div>

      {/* ------------------------- progress stepper ------------------------- */}
      <div className="card mb">
        <strong>Progress</strong>
        {rejected ? (
          <p className="muted mt" style={{ margin: '8px 0 0' }}>
            This complaint was not accepted as an ICT issue — you would have received an email explaining why.
          </p>
        ) : (
          <div className="stage-rail mt">
            {STAGES.map((s, i) => (
              <div key={s.key} className={`stage-rail__step ${i < active ? 'is-done' : ''} ${i === active ? 'is-active' : ''}`}>
                <span className="stage-rail__dot">{i < active ? '✓' : i + 1}</span>
                <strong>{s.label}</strong>
              </div>
            ))}
          </div>
        )}
        {ticket.status === 'waiting_student' && (
          <div className="notice notice--info mt" style={{ marginBottom: 0 }}>
            ICT asked you something — check the messages below and reply so work can continue.
          </div>
        )}
      </div>

      {/* ------------------------- payment details ------------------------- */}
      {payment && (
        <div className="card mb">
          <strong>Payment details</strong>{' '}
          <span className={`badge badge--${payment.verification_status}`}>
            {payment.verification_status === 'verified' ? 'Verified by ICT'
              : payment.verification_status === 'failed_verification' ? 'Not verified'
              : 'Awaiting verification'}
          </span>
          <ul className="muted mt" style={{ margin: '8px 0 0' }}>
            <li>Payment was for: {payment.payment_for || '—'}</li>
            <li>Amount: ₦{payment.amount || '—'} · Method: {payment.payment_method || '—'}</li>
            <li>When: {payment.payment_date || '—'}</li>
          </ul>
        </div>
      )}

      {/* ------------------------- attachments ------------------------- */}
      <div className="card mb">
        <strong>Your attachments ({attachments.length})</strong>
        {attachments.length === 0 && <p className="muted mt" style={{ margin: '8px 0 0' }}>No files attached. If you have a receipt or screenshot, add it below — it goes straight to the ICT officer handling your case.</p>}
        {attachments.length > 0 && (
          <div className="row mt" style={{ flexWrap: 'wrap' }}>
            {attachments.map((a) => (
              <button key={a.id} className="btn btn--outline btn--sm" onClick={() => downloadAttachment(a.id, email)}>
                📎 {a.original_filename}
              </button>
            ))}
          </div>
        )}
        <AddAttachments ticketId={ticketId} email={email} onAdded={load} />
      </div>

      {/* ------------------------- conversation ------------------------- */}
      <div className="card mb">
        <strong>Messages with ICT</strong>
        <p className="muted" style={{ fontSize: '.82rem', margin: '4px 0 0' }}>
          Replies appear here live — you never need to refresh.
        </p>
        <div className="mt" style={{ display: 'grid', gap: 10 }}>
          {messages.length === 0 && <p className="muted">No messages yet — ICT will reply here and by email.</p>}
          {messages.map((m) => (
            <div className={`msg ${m.sender_role === 'system' ? 'msg--system' : ''}`} key={m.id}>
              <div className="msg__head">
                <span className="msg__who">{m.sender_name} {m.sender_role === 'student' ? '(you)' : `(${m.sender_role === 'admin' ? 'Senior ICT' : 'ICT'})`}</span>
                <span className="msg__time">{fmtDateTime(m.created_at)}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.message}</div>
            </div>
          ))}
        </div>
        <form onSubmit={sendReply} className="mt">
          <label className="field"><span>Reply to ICT <small>(they see this instantly)</small></span>
            <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply…" />
          </label>
          <button className={`btn btn--navy btn--sm ${busy ? 'btn--busy' : ''}`} disabled={busy || !reply.trim()}>
            {busy ? 'Sending — please hold on…' : 'Send reply'}
          </button>
        </form>
      </div>

      {/* ------------------------- history ------------------------- */}
      <div className="card">
        <strong>Activity history</strong>
        <ul className="muted mt" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {history.map((h, i) => (
            <li key={i}>
              {h.old_status ? `${STATUS_LABELS[h.old_status] || h.old_status} → ` : ''}
              <strong>{STATUS_LABELS[h.new_status] || h.new_status}</strong>
              {h.note ? ` — ${h.note}` : ''}{' '}
              <span style={{ fontSize: '.78rem' }}>({fmtDateTime(h.created_at)})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Student can attach more evidence later (receipts, screenshots) — no login. */
function AddAttachments({ ticketId, email, onAdded }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [file, setFile] = useState(null);

  async function upload() {
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      const fd = new FormData();
      for (const f of file) fd.append('files', f);
      fd.append('email', email); // ownership proof — no login needed
      const r = await fetch(`/api/tickets/${ticketId}/attachments`, { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      setMsg('Added — the ICT officer can see it now.');
      setFile(null);
      onAdded();
    } catch (e) {
      setMsg(e.message || 'Could not upload — check the file type and size.');
    } finally { setBusy(false); }
  }

  return (
    <div className="mt">
      <label className="field" style={{ marginBottom: 6 }}><span>Add a receipt or screenshot <small>(PNG, JPG, WEBP, GIF or PDF · max 5 MB each)</small></span>
        <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf"
          onChange={(e) => setFile([...e.target.files].slice(0, 5))} />
      </label>
      {file && (
        <button type="button" className="btn btn--navy btn--sm" disabled={busy} onClick={upload}>
          {busy ? 'Uploading…' : `Upload ${file.length} file${file.length === 1 ? '' : 's'}`}
        </button>
      )}
      {msg && <div className={`notice ${msg.startsWith('Added') ? 'notice--ok' : 'notice--err'}`} style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
