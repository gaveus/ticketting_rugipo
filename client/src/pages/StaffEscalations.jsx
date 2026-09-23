import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useAuth, fmtDateTime } from '../auth.jsx';
import { ArrowUp, Inbox } from 'lucide-react';

/** Human "how long has this been waiting" label. */
function waitingSince(iso) {
  if (!iso) return '—';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr${hrs === 1 ? '' : 's'}`;
  return `${Math.round(hrs / 24)} day${Math.round(hrs / 24) === 1 ? '' : 's'}`;
}

/**
 * Senior Engineer queue — complaints escalated by ICT Support Staff.
 * Payment-desk seniors see payment complaints; portal-desk seniors see portal
 * complaints; Super sees everything. Every card carries the full story: who
 * escalated and why, the student, the service, and how long it has waited.
 */
export default function StaffEscalations() {
  const { user } = useAuth();
  const isSenior = user && ['senior', 'admin'].includes(user.role);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [desk, setDesk] = useState('all');

  function load() {
    api('/staff/escalations').then((d) => { setRows(d.escalations); setError(''); }).catch((e) => setError(e.message));
  }
  useEffect(() => { if (isSenior) { load(); const t = setInterval(load, 30000); return () => clearInterval(t); } }, [isSenior]);

  const myDesk = user && user.role === 'senior' && user.specialty ? user.specialty : null;
  const shown = useMemo(() => (rows || []).filter((t) => desk === 'all' || t.specialty === desk), [rows, desk]);
  const counts = useMemo(() => ({
    all: (rows || []).length,
    payment: (rows || []).filter((t) => t.specialty === 'payment').length,
    portal: (rows || []).filter((t) => t.specialty === 'portal').length,
  }), [rows]);
  const oldest = useMemo(() => {
    const times = (rows || []).map((t) => new Date(t.escalated_at).getTime()).filter(Boolean);
    return times.length ? waitingSince(new Date(Math.min(...times)).toISOString()) : null;
  }, [rows]);

  if (!isSenior) return (
    <section className="section container" style={{ maxWidth: 560 }}>
      <div className="card"><h2 className="section__title">Specialist engineers only</h2>
        <p className="section__sub">This queue shows tickets escalated by ICT Support Staff.</p>
        <Link className="btn btn--navy" to="/admin">Staff sign in</Link></div>
    </section>
  );

  return (
    <section className="section container container--wide">
      <div className="pg-head">
        <div>
          <span className="pg-head__eyebrow">Specialist queue</span>
          <h2 className="pg-head__title">
            {myDesk === 'payment' ? 'Payment desk' : myDesk === 'portal' ? 'Portal desk' : 'Escalated complaints'}
          </h2>
          <p className="pg-head__sub">
            {myDesk
              ? `Complaints ICT Support could not finish are routed to you automatically — you handle ${myDesk === 'payment' ? 'payment' : 'portal'} complaints. Open one to resolve it.`
              : 'Handed over by ICT Support for senior review — open a complaint to resolve it.'}
          </p>
        </div>
      </div>

      {/* ------------------------- summary tiles ------------------------- */}
      <div className="grid grid--4 mb">
        <div className="stat stat--urgent">
          <div className="stat__n">{counts.all}</div>
          <div className="stat__label">Waiting for seniors now</div>
          <div className="stat__hint">{oldest ? `Longest waiting: ${oldest}` : 'Nothing in the queue.'}</div>
        </div>
        <div className="stat stat--gold">
          <div className="stat__n">{counts.payment}</div>
          <div className="stat__label">Payment desk</div>
          <div className="stat__hint">Debited but not reflecting, expired links, receipts showing the debit.</div>
        </div>
        <div className="stat stat--green">
          <div className="stat__n">{counts.portal}</div>
          <div className="stat__label">Portal desk</div>
          <div className="stat__hint">Login, registration, results, receipt/printing errors, CBT, admission.</div>
        </div>
        <div className="stat">
          <div className="stat__n"><ArrowUp size={22} /></div>
          <div className="stat__label">Your focus</div>
          <div className="stat__hint">
            {myDesk ? `You handle ${myDesk} complaints — routing to your desk is automatic.` : 'All desks are visible to you, and every ticket is tagged with the desk handling it.'}
          </div>
        </div>
      </div>

      {/* ------------------------- desk filter ------------------------- */}
      <div className="esc-filters mb">
        {[['all', `All (${counts.all})`], ['payment', `Payment (${counts.payment})`], ['portal', `Portal (${counts.portal})`]].map(([k, label]) => (
          <button key={k} type="button" className={`chip-btn ${desk === k ? 'is-active' : ''}`} onClick={() => setDesk(k)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="notice notice--err">{error}</div>}
      {!rows && !error && (
        <div className="page-loading" role="status">
          <span className="page-loading__spinner" aria-hidden="true" />
          <strong>Please hold on while we fetch the queue…</strong>
          <small>Collecting everything waiting for senior review.</small>
        </div>
      )}

      {rows && shown.length === 0 && (
        <div className="card empty-state">
          <div style={{ fontSize: '2rem', color: 'var(--green)' }}><Inbox size={32} /></div>
          <strong>Nothing waiting here</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {desk === 'all'
              ? 'When ICT Support escalates a complaint, it lands in this queue and the seniors are emailed at once.'
              : `No ${desk} complaints are waiting right now.`}
          </p>
        </div>
      )}

      <div className="esc-grid">
        {shown.map((t) => (
          <div className="card esc-card" key={t.id}>
            <div className="esc-card__top">
              <div>
                <strong className="esc-card__num">{t.ticket_number}</strong>
                <span className="muted" style={{ fontSize: '.8rem', display: 'block' }}>{t.category} · {t.issue}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className={`badge ${t.specialty === 'payment' ? 'badge--waiting_student' : 'badge--escalated'}`}>
                  {t.specialty === 'payment' ? 'Payment' : 'Portal'} desk
                </span>
                <span className={`badge badge--${t.priority === 'urgent' || t.priority === 'high' ? 'rejected' : t.status}`}>
                  waiting {waitingSince(t.escalated_at)}
                </span>
              </div>
            </div>

            <p className="esc-card__reason">“{t.escalation_reason}”</p>

            <ul className="esc-card__list">
              <li>
                <span>Student</span>
                <strong>{t.student_name} <small className="muted">({t.matric_no})</small></strong>
              </li>
              <li>
                <span>Where</span>
                <strong>{t.faculty || '—'} → {t.department}</strong>
              </li>
              <li>
                <span>Level</span>
                <strong>{t.level || '—'}</strong>
              </li>
              <li>
                <span>Escalated by</span>
                <strong>{t.escalated_by_name}{t.escalated_by_staff_no ? ` (${t.escalated_by_staff_no})` : ''}</strong>
              </li>
              <li>
                <span>When</span>
                <strong>{fmtDateTime(t.escalated_at)}</strong>
              </li>
            </ul>

            <p className="esc-card__desc">{t.description.length > 160 ? t.description.slice(0, 160) + '…' : t.description}</p>

            <div className="row">
              <Link className="btn btn--navy btn--sm" to={`/admin/tickets/${t.id}`}>Review &amp; resolve →</Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
