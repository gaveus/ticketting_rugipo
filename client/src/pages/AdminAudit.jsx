import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useAuth, fmtDateTime } from '../auth.jsx';

const ACTION_LABELS = {
  'ticket.status': 'Complaint stage changed',
  'ticket.reply': 'Replied to student',
  'ticket.note': 'Internal note added',
  'ticket.assign': 'Complaint assigned',
  'payment.verify': 'Payment checked against records',
  'staff.create': 'Staff account created',
  'staff.role': 'Staff role changed',
  'staff.promote-super': 'Granted Super ICT Support',
  'staff.active': 'Account enabled or disabled',
  'staff.reset-password': 'Password reset',
  'staff.specialty': 'Senior desk changed',
  'masterdata.faculty.create': 'Faculty added',
  'masterdata.department.create': 'Department added',
  'masterdata.category.toggle': 'Service shown or hidden',
  'announcement.create': 'Homepage update posted',
  'announcement.delete': 'Homepage update removed',
  'inbox.reply': 'Replied to a student question',
  'inbox.close': 'Conversation closed',
  'newsletter.broadcast': 'Newsletter sent',
};

/** Audit trail — Super ICT Support only. Every staff action lands here. */
export default function AdminAudit() {
  const { user } = useAuth();
  const isSuper = user?.role === 'admin';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [params, setParams] = useSearchParams();
  const filter = params.get('action') || '';
  const ticket = params.get('ticket') || '';

  function set(k, v) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  }

  function load() {
    const qs = new URLSearchParams();
    if (filter) qs.set('action', filter);
    if (ticket) qs.set('ticket', ticket);
    api(`/staff/admin/audit-log?${qs}`).then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => { if (isSuper) load(); }, [isSuper, filter, ticket]);

  if (!isSuper) return <div className="notice notice--err">Only the Super ICT Support can view the audit trail.</div>;
  if (error) return <div className="notice notice--err">{error}</div>;
  if (!data) return (
    <div className="page-loading" role="status">
      <span className="page-loading__spinner" aria-hidden="true" />
      <strong>Please hold on while we fetch your details…</strong>
      <small>Reading the activity log — who did what, and when.</small>
    </div>
  );

  const describe = (e) => {
    try {
      const m = e.metadata ? JSON.parse(e.metadata) : {};
      if (e.action === 'ticket.status') return `open → ${m.to || '?'}`;
      if (e.action === 'ticket.assign') return m.staffId ? `to staff #${m.staffId}` : '';
      if (e.action === 'staff.create') return m.email ? `for ${m.email} (${m.role})` : '';
      if (e.action === 'staff.role') return `${m.from || '?'} → ${m.to || '?'}`;
      if (e.action === 'payment.verify') return m.outcome || '';
      return Object.keys(m).length ? JSON.stringify(m) : '';
    } catch { return e.metadata || ''; }
  };

  return (
    <>
      <h2 className="section__title">Activity log</h2>
      <p className="section__sub">
        Every action taken by every officer — who attended to which complaint, what they changed, and when (Lagos time).
        Search by ticket number to see one complaint's full story.
      </p>

      <div className="filters">
        <input placeholder="Search by ticket number e.g. RGP-2026-A0001…" value={ticket}
          onChange={(e) => set('ticket', e.target.value)} style={{ minWidth: 240 }} />
        <select value={filter} onChange={(e) => set('action', e.target.value)}>
          <option value="">All actions</option>
          {data.actions.map((a) => (
            <option key={a.action} value={a.action}>{ACTION_LABELS[a.action] || a.action} ({a.n})</option>
          ))}
        </select>
      </div>

      {data.entries.length === 0 && <div className="card"><p className="muted">Nothing here yet — this fills up automatically as officers attend to complaints.</p></div>}
      {data.entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When (Lagos)</th><th>Officer</th><th>Action</th><th>Complaint</th><th>Detail</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</td>
                  <td><strong>{e.actor_name || 'system'}</strong></td>
                  <td>{ACTION_LABELS[e.action] || e.action}</td>
                  <td>{e.ticket_number
                    ? <><Link to={`/admin/tickets/${e.entity_id}`}>{e.ticket_number}</Link>{e.student_name && <span className="muted" style={{ fontSize: '.78rem' }}> · {e.student_name}</span>}</>
                    : e.entity_type === 'ticket' ? `#${e.entity_id}` : '—'}</td>
                  <td className="muted" style={{ fontSize: '.82rem' }}>{describe(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
