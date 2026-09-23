import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useAuth, fmtDateTime, fmtDate } from '../auth.jsx';
import { Ticket, UserPlus, ShieldCheck, Megaphone, CreditCard, MessageCircle, Settings, Search } from 'lucide-react';

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

function iconFor(action) {
  if (action.startsWith('ticket.reply') || action.startsWith('inbox.')) return MessageCircle;
  if (action.startsWith('payment.')) return CreditCard;
  if (action.startsWith('staff.')) return UserPlus;
  if (action.startsWith('announcement.') || action.startsWith('newsletter.')) return Megaphone;
  if (action.startsWith('masterdata.')) return Settings;
  if (action.startsWith('ticket.')) return Ticket;
  return ShieldCheck;
}
function toneFor(action) {
  if (action.startsWith('staff.')) return 'audit-item__ic--staff';
  if (action.startsWith('payment.')) return 'audit-item__ic--pay';
  if (action.startsWith('announcement.') || action.startsWith('newsletter.')) return 'audit-item__ic--announce';
  return '';
}

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
  useEffect(() => { if (isSuper) load(); }, [isSuper, filter, ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group entries by calendar day (Lagos time) for the timeline's day markers.
  const days = useMemo(() => {
    if (!data?.entries?.length) return [];
    const groups = new Map();
    for (const e of data.entries) {
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e.created_at));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    return [...groups.entries()].map(([day, entries]) => ({
      day,
      label: day === new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
        ? 'Today'
        : fmtDate(entries[0].created_at),
      entries,
    }));
  }, [data]);

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

  if (!isSuper) return <div className="notice notice--err">Only the Super ICT Support can view the audit trail.</div>;
  if (error) return <div className="notice notice--err">{error}</div>;

  return (
    <>
      <div className="pg-head">
        <div>
          <span className="pg-head__eyebrow">Who did what</span>
          <h2 className="pg-head__title">Activity log</h2>
          <p className="pg-head__sub">
            Every action taken by every officer — who attended to which complaint, what they changed, and when.
            Search by ticket number to see one complaint's full story.
          </p>
        </div>
      </div>

      <div className="tool-bar">
        <span className="tb-ic" aria-hidden="true"><Search size={16} /></span>
        <input placeholder="Search by ticket number e.g. RGP-2026-A0001…" value={ticket}
          onChange={(e) => set('ticket', e.target.value)} aria-label="Search by ticket number" />
        <select value={filter} onChange={(e) => set('action', e.target.value)} aria-label="Filter by action">
          <option value="">All actions</option>
          {data?.actions.map((a) => (
            <option key={a.action} value={a.action}>{ACTION_LABELS[a.action] || a.action} ({a.n})</option>
          ))}
        </select>
      </div>

      {!data && (
        <div className="page-loading" role="status">
          <span className="page-loading__spinner" aria-hidden="true" />
          <strong>Please hold on while we fetch your details…</strong>
          <small>Reading the activity log — who did what, and when.</small>
        </div>
      )}

      {data && data.entries.length === 0 && (
        <div className="card empty-state">
          <div className="inbox-empty__art"><ShieldCheck size={28} /></div>
          <strong>Nothing here yet</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>This fills up automatically as officers attend to complaints.</p>
        </div>
      )}

      {data && data.entries.length > 0 && (
        <div className="audit-tl">
          {days.map((d) => (
            <div className="audit-day" key={d.day}>
              <span className="audit-day__label">{d.label}</span>
              {d.entries.map((e) => {
                const Ic = iconFor(e.action);
                return (
                  <div className="audit-item" key={e.id}>
                    <span className={`audit-item__ic ${toneFor(e.action)}`} aria-hidden="true"><Ic size={16} /></span>
                    <div className="audit-item__body">
                      <div className="audit-item__what">{ACTION_LABELS[e.action] || e.action}{describe(e) && <span className="muted" style={{ fontWeight: 500 }}> — {describe(e)}</span>}</div>
                      <div className="audit-item__meta">
                        by <strong>{e.actor_name || 'system'}</strong>
                        {e.ticket_number
                          ? <> · <Link to={`/admin/tickets/${e.entity_id}`}>{e.ticket_number}</Link>{e.student_name ? ` · ${e.student_name}` : ''}</>
                          : e.entity_type === 'ticket' ? ` · complaint #${e.entity_id}` : ''}
                      </div>
                    </div>
                    <span className="audit-item__time">{fmtDateTime(e.created_at)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
