import React, { useEffect, useState } from 'react';
import { ChevronDown, ArrowRight, X, CheckCircle2, ArrowUp, Check, CheckCheck, XCircle, FileText, Paperclip, Mail, Image as ImageIcon } from 'lucide-react';

/** Plain-language meaning of each stage — shown on the action buttons. */
const STATUS_EXPLAIN = {
  open: 'Back in the queue — no one is on it yet',
  assigned: 'Named officer, work not started',
  in_progress: 'Actively being worked on right now',
  waiting_student: 'We asked the student something — pause until they answer',
  rejected: 'Not a valid ICT complaint — student is told by email',
  closed: 'Fully finished and filed away',
};
import { Link, useParams } from 'react-router-dom';
import { api, downloadAttachment, useAuth, fmtDateTime, fmtDate } from '../auth.jsx';
import { STATUS_LABELS } from '../components/Layout.jsx';

/** One tidy dropdown for any "stage" move that is not Resolve / Escalate. */
function StageMenu({ allowed, busy, isEscalated, isSeniorPlus, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  if (!allowed.length) return null;
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="btn btn--outline btn--sm" aria-haspopup="menu" aria-expanded={open}
        disabled={busy || (isEscalated && !isSeniorPlus)}
        onClick={() => setOpen((o) => !o)}>
        Change stage <ChevronDown size={13} style={{ verticalAlign: '-2px', marginLeft: 3 }} />
      </button>
      {open && (
        <div className="menu-list menu-list--sheet" role="menu">
          <div className="menu-list__grip" aria-hidden="true" />
          {allowed.map((s) => (
            <button key={s} role="menuitem" type="button"
              onClick={() => { setOpen(false); onPick(s); }}
              title={STATUS_EXPLAIN[s] || ''}>
              <ArrowRight size={12} style={{ verticalAlign: '-1px', marginRight: 5 }} />{STATUS_LABELS[s]}
              {STATUS_EXPLAIN[s] && <small style={{ display: 'block', fontWeight: 400, color: 'var(--muted)', fontSize: '.74rem' }}>{STATUS_EXPLAIN[s]}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Image evidence opens in a lightbox so staff can actually read the receipt. */
function EvidenceLightbox({ url, name, onClose }) {
  if (!url) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--evidence" onClick={(e) => e.stopPropagation()}>
        <div className="row row--between" style={{ marginBottom: 8 }}>
          <strong style={{ wordBreak: 'break-all' }}>{name}</strong>
          <button type="button" className="btn btn--outline btn--sm" onClick={onClose}><X size={13} style={{ verticalAlign: '-2px', marginRight: 3 }} />Close</button>
        </div>
        <img src={url} alt={name} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 10, border: '1px solid var(--line)' }} />
      </div>
    </div>
  );
}

/**
 * Ticket detail — the staff workspace for one complaint.
 * Left: description, evidence gallery (visible + viewable), conversation,
 * internal notes. Right: student card, history, escalation record, assignment.
 * Top: one tidy action bar — Resolve / Escalate first-class, everything else
 * tucked into a "Change stage" menu so nothing is scattered around.
 */
export default function StaffTicket() {
  const { id } = useParams();
  const { user } = useAuth();
  const isSeniorPlus = user && ['senior', 'admin'].includes(user.role);
  const isSuper = user?.role === 'admin';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null); // 'resolve' | 'escalate' | null
  const [actionNote, setActionNote] = useState('');
  const [reply, setReply] = useState('');
  const [emailReply, setEmailReply] = useState(false);
  const [note, setNote] = useState('');
  const [lightbox, setLightbox] = useState(null); // { url, name }

  function load() { api(`/staff/tickets/${id}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)); }
  useEffect(() => { if (user) load(); }, [id, user]);
  // Near-live conversation: pick up new student replies within seconds.
  useEffect(() => {
    if (!user) return;
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  if (!user) return null;
  if (error && !data) return <section className="section container"><div className="notice notice--err">{error}</div></section>;
  if (!data) return (
    <div className="page-loading" role="status">
      <span className="page-loading__spinner" aria-hidden="true" />
      <strong>Please hold on while we fetch your details…</strong>
      <small>Loading this complaint — it will only take a moment.</small>
    </div>
  );

  const { ticket, student, studentHistory, messages, attachments, payment, history, staffList, escalation, allowedTransitions, viewerRole } = data;

  const canResolve = allowedTransitions.includes('resolved');
  const canEscalate = allowedTransitions.includes('escalated');
  const isEscalated = ticket.status === 'escalated';
  const otherTransitions = allowedTransitions.filter((s) => !['resolved', 'escalated'].includes(s));

  async function act(path, body, okMsg = 'Done.') {
    setBusy(true); setMsg('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      setMsg(okMsg);
      setPanel(null); setActionNote('');
      load();
      return true;
    } catch (e) { setMsg(e.message); return false; }
    finally { setBusy(false); }
  }

  async function resolve() {
    if (!(actionNote.trim().length >= 5)) { setMsg('Add a short note about what was done (at least 5 characters) — it is emailed to the student.'); return; }
    await act(`/staff/tickets/${id}/status`, { status: 'resolved', note: actionNote.trim() },
      'Resolved — the student has been emailed automatically.');
  }
  async function escalate() {
    if (actionNote.trim().length < 5) { setMsg('An escalation reason is required (at least 5 characters).'); return; }
    await act(`/staff/tickets/${id}/status`, { status: 'escalated', note: actionNote.trim() },
      'Escalated — the specialist engineers for this desk have been notified by email.');
  }

  const staffMsgs = messages.filter((m) => ['staff', 'senior', 'admin'].includes(m.sender_role));
  const attendedBy = staffMsgs.length > 0 ? staffMsgs[staffMsgs.length - 1].sender_name : null;

  const studentMsgs = messages.filter((m) => m.visibility === 'student');
  const internalMsgs = messages.filter((m) => m.visibility === 'internal');

  return (
    <section className="section container container--wide">
      {/* ------------------------------ header ------------------------------ */}
      <div className="detail-head card mb">
        <div className="detail-head__main">
          <div className="detail-head__id">
            <h2 className="section__title" style={{ marginBottom: 0 }}>{ticket.ticket_number}</h2>
            <span className={`badge badge--${ticket.status}`}>{STATUS_LABELS[ticket.status]}</span>
            {isEscalated && <span className="badge badge--escalated">With Specialist Engineer</span>}
            <span className={`badge ${ticket.priority === 'urgent' || ticket.priority === 'high' ? 'badge--rejected' : ''}`}>{ticket.priority}</span>
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {ticket.category} · {ticket.issue} · logged {fmtDateTime(ticket.created_at)}
          </p>
        </div>
        <div className="detail-head__meta">
          <div><small>Last update</small><strong>{fmtDate(ticket.updated_at)}</strong></div>
          <div><small>Assigned to</small><strong>{ticket.assigned_staff_id ? (staffList.find((s) => s.id === ticket.assigned_staff_id)?.full_name || '—') : 'Unassigned'}</strong></div>
          <div><small>Attended by</small><strong>{attendedBy || 'Not yet'}</strong></div>
        </div>
      </div>

      {error && <div className="notice notice--err">{error}</div>}
      {msg && <div className="notice notice--ok">{msg}</div>}

      {/* ---------------------------- action bar ---------------------------- */}
      <div className="action-bar card mb">
        <div className="action-bar__label">
          <strong>Take action</strong>
          <small className="muted">What each step does is written under the button — nothing happens without your confirmation.</small>
        </div>
        {isEscalated && !isSeniorPlus && (
          <p className="muted" style={{ margin: 0, flexBasis: '100%' }}>
            <ArrowUp size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />This complaint is with the specialist engineers now — you can still reply to the student and add internal notes below; only they can resolve it.
          </p>
        )}
        {canResolve && (
          <button className="btn btn--resolve" disabled={busy} onClick={() => { setPanel(panel === 'resolve' ? null : 'resolve'); setActionNote(''); }}>
            <CheckCircle2 size={16} style={{ verticalAlign: '-3px', marginRight: 5 }} />Mark as solved
            <small>Student gets an email straight away</small>
          </button>
        )}
        {canEscalate && (
          <button className="btn btn--escalate" disabled={busy} onClick={() => { setPanel(panel === 'escalate' ? null : 'escalate'); setActionNote(''); }}>
            <ArrowUp size={16} style={{ verticalAlign: '-3px', marginRight: 5 }} />Send to Specialist Engineer
            <small>For problems beyond first-line — they take it from here</small>
          </button>
        )}
        <StageMenu allowed={otherTransitions} busy={busy} isEscalated={isEscalated} isSeniorPlus={isSeniorPlus}
          onPick={(s) => act(`/staff/tickets/${id}/status`, { status: s }, `Stage changed to ${STATUS_LABELS[s]}`)} />
        {allowedTransitions.length === 0 && !isEscalated && <p className="muted" style={{ margin: 0 }}>This complaint is fully finished — nothing left to do.</p>}
      </div>

      {panel === 'resolve' && (
        <div className="card card--action mb">
          <strong><CheckCheck size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Mark as solved</strong>
          <p className="muted" style={{ fontSize: '.88rem', margin: '4px 0 8px' }}>
            The moment you confirm, an email goes to <strong>{student.email}</strong> automatically — you never type their address.
          </p>
          <textarea rows={2} placeholder="What was done? e.g. Payment verified on Appiawave and portal status corrected — course registration is now open."
            value={actionNote} onChange={(e) => setActionNote(e.target.value)} />
          <div className="row mt" style={{ gap: 8 }}>
            <button className={`btn btn--resolve btn--sm ${busy ? 'btn--busy' : ''}`} disabled={busy} onClick={resolve}>
              {busy ? 'Working — please hold on…' : 'Confirm resolution & send email'}
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </div>
      )}
      {panel === 'escalate' && (
        <div className="card card--action mb">
          <strong><ArrowUp size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Send to Specialist Engineer</strong>
          <p className="muted" style={{ fontSize: '.88rem', margin: '4px 0 8px' }}>
            Explains <em>why</em> — this note is emailed to the engineers for this desk and stored on the escalation record.
            {isSuper ? ' Super ICT Support sees every desk.' : ''}
          </p>
          <textarea rows={2} placeholder="e.g. Payment confirmed in Appiawave but the portal still shows unpaid after 48 hours — needs a senior engineer."
            value={actionNote} onChange={(e) => setActionNote(e.target.value)} />
          <div className="row mt" style={{ gap: 8 }}>
            <button className={`btn btn--escalate btn--sm ${busy ? 'btn--busy' : ''}`} disabled={busy} onClick={escalate}>
              {busy ? 'Working — please hold on…' : 'Escalate with this reason'}
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="detail-grid">
        {/* ============================== LEFT ============================== */}
        <div>
          {/* description */}
          <div className="card mb">
            <strong>What the student reported</strong>
            <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{ticket.description}</p>
            {ticket.details && Object.entries(ticket.details).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '').length > 0 && (
              <>
                <div className="divider" />
                <strong>Guided answers</strong>
                <ul className="muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {Object.entries(ticket.details)
                    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
                    .map(([k, v]) => (
                      <li key={k}><strong style={{ textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}:</strong> {String(v)}</li>
                    ))}
                </ul>
              </>
            )}
          </div>

          {/* payment verification */}
          {payment && (
            <div className="card mb">
              <div className="row row--between">
                <strong>Payment verification</strong>
                <span className={`badge badge--${payment.verification_status || 'unverified'}`}>{(payment.verification_status || 'unverified').replace('_', ' ')}</span>
              </div>
              <ul className="muted mt" style={{ margin: '8px 0', paddingLeft: 18 }}>
                <li>Portal shows: <strong>{payment.portal_status || '—'}</strong></li>
                <li>What happened after payment: {payment.what_happened || '—'}</li>
                {payment.payment_for && <li>Payment was for: {payment.payment_for}</li>}
                {payment.amount && <li>Amount: ₦{payment.amount} · Method: {payment.payment_method || '—'} · Date: {payment.payment_date || '—'}</li>}
                {payment.verified_by_name && <li>Verified by {payment.verified_by_name} · {fmtDateTime(payment.verified_at)}</li>}
              </ul>
              {(!payment.verification_status || payment.verification_status === 'unverified') && (
                <div className="row">
                  <button className="btn btn--sm" style={{ background: 'var(--green)', color: '#fff' }} disabled={busy}
                    onClick={() => act(`/staff/tickets/${id}/verify-payment`, { outcome: 'verified', note: 'Confirmed against payment records' }, 'Payment marked verified.')}>
                    <Check size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Verified in records
                  </button>
                  <button className="btn btn--danger btn--sm" disabled={busy}
                    onClick={() => act(`/staff/tickets/${id}/verify-payment`, { outcome: 'failed_verification', note: 'No matching record found' }, 'Marked as failed verification.')}>
                    <XCircle size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />No record found
                  </button>
                </div>
              )}
              <p className="muted" style={{ fontSize: '.78rem', margin: '8px 0 0' }}>
                Receipts are evidence only — always confirm against Appiawave records before resolving a payment complaint.
              </p>
            </div>
          )}

          {/* attachments — every piece of evidence, viewable right here */}
          {attachments.length > 0 && (
            <div className="card mb">
              <div className="row row--between">
                <strong>Evidence ({attachments.length})</strong>
                <span className="muted" style={{ fontSize: '.78rem' }}>uploaded by the student</span>
              </div>
              <div className="evidence-grid mt">
                {attachments.map((a) => {
                  const isImage = (a.mime_type || '').startsWith('image/');
                  const isPdf = (a.mime_type || '').includes('pdf');
                  return (
                    <div key={a.id} className="evidence-item">
                      <button type="button" className="evidence-item__thumb"
                        title={isImage ? 'View full size' : 'Open the file'}
                        onClick={() => {
                          if (!isImage) { downloadAttachment(a.id); return; }
                          const raw = localStorage.getItem('rugipo.staff');
                          const token = raw ? JSON.parse(raw).token : null;
                          fetch(`/api/attachments/${a.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
                            .then(async (r) => {
                              if (!r.ok) throw new Error('Could not load the file');
                              const type = r.headers.get('content-type') || '';
                              if (type.includes('application/json')) {
                                const d = await r.json();
                                if (d.url) setLightbox({ url: d.url, name: a.original_filename });
                              } else {
                                const blob = await r.blob();
                                setLightbox({ url: URL.createObjectURL(blob), name: a.original_filename });
                              }
                            })
                            .catch((e) => setMsg(e.message));
                        }}>
                        {isImage
                          ? <EvidenceThumb id={a.id} />
                          : <span className="evidence-item__icon">{isPdf ? <FileText size={16} /> : <Paperclip size={16} />}</span>}
                      </button>
                      <div className="evidence-item__meta">
                        <strong title={a.original_filename}>{a.original_filename}</strong>
                        <small>{Math.round((a.size || 0) / 1024)} KB · {fmtDate(a.created_at)}</small>
                        <div className="row" style={{ gap: 6 }}>
                          <button type="button" className="btn btn--outline btn--sm"
                            onClick={() => downloadAttachment(a.id)}>Open</button>
                          {isImage && (
                            <button type="button" className="btn btn--outline btn--sm"
                              onClick={() => {
                                // Fetch the authorized URL, then open the lightbox.
                                const raw = localStorage.getItem('rugipo.staff');
                                const token = raw ? JSON.parse(raw).token : null;
                                fetch(`/api/attachments/${a.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
                                  .then(async (r) => {
                                    if (!r.ok) throw new Error('Could not load the file');
                                    const type = r.headers.get('content-type') || '';
                                    if (type.includes('application/json')) {
                                      const d = await r.json();
                                      if (d.url) { setLightbox({ url: d.url, name: a.original_filename }); return; }
                                    }
                                    const blob = await r.blob();
                                    setLightbox({ url: URL.createObjectURL(blob), name: a.original_filename });
                                  })
                                  .catch((e) => setMsg(e.message));
                              }}>
                              View
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* conversation — student-visible */}
          <div className="card mb">
            <div className="row row--between">
              <strong>Conversation with student</strong>
              <span className="badge badge--resolved">{studentMsgs.length} message{studentMsgs.length === 1 ? '' : 's'}</span>
            </div>
            <p className="muted" style={{ fontSize: '.82rem', margin: '4px 0 0' }}>
              The student sees everything here on their tracking page. Emails only go out when you tick “also email”.
            </p>
            <div className="timeline mt">
              {studentMsgs.length === 0 && <p className="muted">No student-visible messages yet — start the conversation below.</p>}
              {studentMsgs.map((m) => (
                <div className={`msg ${m.sender_role === 'system' ? 'msg--system' : ''}`} key={m.id}>
                  <div className="msg__head">
                    <span className="msg__who">{m.sender_name}{m.sender_role !== 'system' && <small> · {m.sender_role === 'student' ? 'student' : 'ICT'}</small>}</span>
                    <span className="msg__time">{fmtDateTime(m.created_at)}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.message}</div>
                </div>
              ))}
            </div>
            <label className="field mt"><span>Reply to {student.fullName.split(/\s+/)[0]} <small>(they see this on the tracking page — tick below to also email it)</small></span>
              <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0 10px', fontSize: '.86rem' }}>
              <input type="checkbox" checked={emailReply} onChange={(e) => setEmailReply(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span><Mail size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Also email this reply to the student <small>(leave unticked — the tracking page is enough)</small></span>
            </label>
            <button className={`btn btn--navy btn--sm ${busy ? 'btn--busy' : ''}`} disabled={busy || !reply.trim()}
              onClick={() => { act(`/staff/tickets/${id}/reply`, { message: reply, emailIt: emailReply }, emailReply ? 'Reply sent + emailed to the student.' : 'Reply sent to the tracking page.').then(() => setReply('')); }}>
              {busy ? 'Sending…' : 'Send reply'}
            </button>
          </div>

          {/* internal notes */}
          <div className="card mb">
            <div className="row row--between">
              <strong>Internal notes</strong>
              <span className="badge badge--rejected">{internalMsgs.length} note{internalMsgs.length === 1 ? '' : 's'}</span>
            </div>
            <p className="muted" style={{ fontSize: '.82rem', margin: '4px 0 0' }}>
              Staff-only. The student <strong>never</strong> sees these — use them for handovers and senior review.
            </p>
            <div className="timeline mt">
              {internalMsgs.length === 0 && <p className="muted">No internal notes yet.</p>}
              {internalMsgs.map((m) => (
                <div className={`msg msg--internal ${m.sender_role === 'system' ? 'msg--system' : ''}`} key={m.id}>
                  <div className="msg__head">
                    <span className="msg__who">{m.sender_name}</span>
                    <span className="msg__tag">internal</span>
                    <span className="msg__time">{fmtDateTime(m.created_at)}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.message}</div>
                </div>
              ))}
            </div>
            <label className="field mt"><span>Add internal note</span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className={`btn btn--sm ${busy ? 'btn--busy' : ''}`} style={{ background: 'var(--gold)', color: 'var(--green-deep)' }}
              disabled={busy || !note.trim()}
              onClick={() => { act(`/staff/tickets/${id}/note`, { message: note }, 'Internal note saved.').then(() => setNote('')); }}>
              {busy ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>

        {/* ============================== RIGHT ============================= */}
        <div>
          <div className="card mb">
            <strong>Student</strong>
            <ul className="student-list mt">
              <li><span>Name</span><strong>{student.fullName}</strong></li>
              <li><span>Matric no</span><strong>{student.matricNo}</strong></li>
              {ticket.reg_no && <li><span>Reg no</span><strong>{ticket.reg_no}</strong></li>}
              {student.faculty && <li><span>Faculty</span><strong>{student.faculty}</strong></li>}
              <li><span>Department</span><strong>{student.department}</strong></li>
              <li><span>Level</span><strong>{student.level}{ticket.academic_level ? ` (${ticket.academic_level} · ${ticket.study_mode === 'PART_TIME' ? 'Part-Time' : 'Full-Time'})` : ''}</strong></li>
              <li><span>Phone</span><strong>{student.phone}</strong></li>
              <li><span>Email</span><strong style={{ wordBreak: 'break-all' }}>{student.email}</strong></li>
            </ul>
            {student.ticketCount > 1 && (
              <p className="muted" style={{ fontSize: '.8rem', margin: '8px 0 0' }}>
                This student has <strong>{student.ticketCount}</strong> complaints on record.
              </p>
            )}
          </div>

          {studentHistory?.length > 0 && (
            <div className="card mb">
              <strong>Previous complaints</strong>
              <ul className="muted mt" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '.85rem' }}>
                {studentHistory.map((h) => (
                  <li key={h.id} style={{ marginBottom: 4 }}>
                    <Link to={`/admin/tickets/${h.id}`}>{h.ticket_number}</Link> — {h.category} · {STATUS_LABELS[h.status]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {escalation && (
            <div className="card card--escalation mb">
              <strong>Escalation record</strong>
              <ul className="muted" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '.88rem' }}>
                <li><strong>Escalated by:</strong> {escalation.escalater_name || escalation.escalated_by_name}{escalation.escalated_by_staff_no || escalation.escalater_staff_no ? ` (${escalation.escalated_by_staff_no || escalation.escalater_staff_no})` : ''}</li>
                <li><strong>Reason:</strong> {escalation.reason}</li>
                <li><strong>Desk:</strong> {escalation.specialty === 'payment' ? 'Payment' : 'Portal'}</li>
                <li><strong>When:</strong> {fmtDateTime(escalation.created_at)}</li>
                {escalation.resolved_by_name && <li><strong>Closed by:</strong> {escalation.resolved_by_name} · {fmtDateTime(escalation.resolved_at)}</li>}
              </ul>
            </div>
          )}

          <div className="card mb">
            <strong>Assignment</strong>
            <p className="muted" style={{ margin: '6px 0' }}>
              {ticket.assigned_staff_id
                ? staffList.find((s) => s.id === ticket.assigned_staff_id)?.full_name || '—'
                : 'No hand-over — any officer who works on it is recorded automatically'}
            </p>
            {attendedBy && (
              <p className="muted" style={{ fontSize: '.82rem', margin: '0 0 8px' }}>
                <strong>Attended by:</strong> {attendedBy} — their name is on the record and in the audit trail.
              </p>
            )}
            <select className="field" defaultValue="" disabled={busy}
              onChange={(e) => { if (e.target.value) { act(`/staff/tickets/${id}/assign`, { staffId: Number(e.target.value) }, 'Ticket assigned.'); e.target.value = ''; } }}>
              <option value="">
                {isSuper ? 'Reassign to…' : ticket.assigned_staff_id === user.id ? 'Currently yours' : 'Assign to me'}
              </option>
              {(isSuper ? staffList : staffList.filter((s) => s.id === user.id)).map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}{s.role === 'admin' ? ' (Super)' : s.role === 'senior' ? ' (Senior)' : ''}</option>
              ))}
            </select>
            {!isSuper && (
              <p className="muted" style={{ fontSize: '.75rem', margin: '6px 0 0' }}>
                Only a Super ICT Support can assign tickets to other staff — you can take a ticket for yourself.
              </p>
            )}
          </div>

          <div className="card">
            <strong>Activity history</strong>
            <ul className="timeline-list mt">
              {history.map((h, i) => (
                <li key={i}>
                  <div>
                    {h.old_status ? `${STATUS_LABELS[h.old_status] || h.old_status} → ` : ''}
                    <strong>{STATUS_LABELS[h.new_status] || h.new_status}</strong>
                    {h.note ? <span className="muted"> — {h.note}</span> : ''}
                  </div>
                  <small className="muted">{h.changed_by || 'system'} · {fmtDateTime(h.created_at)}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {lightbox && <EvidenceLightbox url={lightbox.url} name={lightbox.name} onClose={() => setLightbox(null)} />}
    </section>
  );
}

/** Small authorized image preview inside the evidence grid. */
function EvidenceThumb({ id }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const raw = localStorage.getItem('rugipo.staff');
    const token = raw ? JSON.parse(raw).token : null;
    let dead = false;
    fetch(`/api/attachments/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (r) => {
        if (!r.ok) return;
        const type = r.headers.get('content-type') || '';
        if (type.includes('application/json')) {
          const d = await r.json();
          if (d.url && !dead) setUrl(d.url);
        } else {
          const blob = await r.blob();
          if (!dead) setUrl(URL.createObjectURL(blob));
        }
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [id]);
  if (!url) return <span className="evidence-item__icon"><ImageIcon size={16} /></span>;
  return <img src={url} alt="" loading="lazy" />;
}
