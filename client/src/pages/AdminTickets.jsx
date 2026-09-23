import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useAuth, fmtDateTime } from '../auth.jsx';
import { Check, Inbox, Search, ArrowRight, Filter } from 'lucide-react';
import { STATUS_LABELS } from '../components/Layout.jsx';

const STATUS_OPTIONS = ['', 'open', 'assigned', 'in_progress', 'waiting_student', 'escalated', 'resolved', 'closed', 'rejected'];

const STAGE_DOT = {
  open: '#d97706', assigned: '#2563eb', in_progress: '#7c3aed',
  waiting_student: '#ca8a04', escalated: '#c2410c', resolved: '#0f7a3d',
  closed: '#5a6478', rejected: '#991b1b',
};

function initialsOf(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

/**
 * Complaint queue — a designed list, not a data table.
 * Each row: identity avatar + tracking ID, student, what broke, stage pill,
 * who is on it, and an Open action. Hand-over lives in the detail page too,
 * but stays here for speed (super only sees it on wide screens).
 */
export default function AdminTickets({ mine = false }) {
  const { user } = useAuth();
  const isSuper = user?.role === 'admin';
  const [meta, setMeta] = useState({ categories: [] });
  const [list, setList] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [params, setParams] = useSearchParams();
  const filters = {
    status: params.get('status') || '', category: params.get('category') || '',
    q: params.get('q') || '', from: params.get('from') || '', to: params.get('to') || '',
    unattended: params.get('unattended') || '',
    day: params.get('day') || '', month: params.get('month') || '', year: params.get('year') || '',
  };

  const when = params.get('when') || '';

  function set(k, v) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  }

  const fmtDay = (d) => d.toISOString().slice(0, 10);

  /** "When" selector — week starts Monday, like the school calendar. */
  function setWhen(w) {
    const next = new URLSearchParams(params);
    next.delete('from'); next.delete('to');
    const now = new Date();
    if (w === 'week') {
      const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      next.set('from', fmtDay(monday)); next.set('to', fmtDay(now));
    } else if (w === 'month') {
      next.set('from', fmtDay(new Date(now.getFullYear(), now.getMonth(), 1))); next.set('to', fmtDay(now));
    } else if (w === 'custom') {
      const back = new Date(now.getTime() - 30 * 86400_000);
      next.set('from', filters.from || fmtDay(back)); next.set('to', filters.to || fmtDay(now));
    }
    if (w) next.set('when', w); else next.delete('when');
    setParams(next, { replace: true });
  }

  function load() {
    const qp = new URLSearchParams(params);
    if (mine) qp.set('staff', 'mine');
    if (filters.day) qp.set('day', filters.day);
    if (filters.month) qp.set('month', filters.month);
    if (filters.year) qp.set('year', filters.year);
    api(`/staff/tickets?${qp}`).then((d) => setList(d.tickets)).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [params, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api('/meta').then(setMeta).catch(() => {});
    api('/staff/admin/staff').then((d) => setStaffList(d.staff.filter((s) => s.active))).catch(() => {});
  }, []);

  async function assign(ticketId, staffId) {
    setMsg('');
    try {
      await api(`/staff/tickets/${ticketId}/assign`, { method: 'POST', body: JSON.stringify({ staffId }) });
      setMsg('Complaint handed over — the officer has been notified by email.');
      load();
    } catch (e) { setMsg(e.message); }
  }

  const quickStages = [
    { key: '', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'waiting_student', label: 'Waiting on student' },
    { key: 'escalated', label: 'Escalated' },
    { key: 'resolved', label: 'Resolved' },
  ];
  const counts = (key) => {
    if (!list) return null;
    if (!key) return list.length;
    // The server already filtered by status if set — counts reflect the full
    // picture only when no status filter is active. Honest label either way.
    return filters.status === key ? list.length : filters.status ? null : list.filter((t) => t.status === key).length;
  };

  return (
    <>
      {/* ---------------- page header ---------------- */}
      <div className="pg-head">
        <div>
          <span className="pg-head__eyebrow">{mine ? 'My desk' : 'Complaint queue'}</span>
          <h2 className="pg-head__title">{mine ? 'Assigned to me' : 'All complaints'}</h2>
          <p className="pg-head__sub">
            {list
              ? <><strong>{list.length}</strong> {list.length === 1 ? 'complaint' : 'complaints'} shown{filters.unattended ? ' — unattended only' : ''}</>
              : 'Loading…'}
          </p>
        </div>
        <div className="pg-head__actions">
          <button type="button" className={`btn btn--sm ${filters.unattended ? 'btn--gold' : 'btn--outline'}`}
            onClick={() => set('unattended', filters.unattended ? '' : '1')}>
            {filters.unattended ? <><Check size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />Showing unattended</> : 'Show unattended only'}
          </button>
        </div>
      </div>

      {/* deep link from Reports — one day / month / year */}
      {(filters.day || filters.month || filters.year) && (
        <div className="tool-bar" style={{ borderLeft: '4px solid var(--gold)' }}>
          <strong style={{ color: 'var(--green-deep)', fontSize: '.9rem' }}>
            {filters.day ? 'One day: ' + filters.day : filters.month ? 'One month: ' + filters.month : 'One year: ' + filters.year}
          </strong>
          <span className="pg-head__sub" style={{ margin: 0 }}>(opened from the Reports page)</span>
          <button type="button" className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }}
            onClick={() => { const n = new URLSearchParams(params); n.delete('day'); n.delete('month'); n.delete('year'); setParams(n, { replace: true }); }}>
            Show everything
          </button>
        </div>
      )}

      {error && <div className="notice notice--err">{error}</div>}
      {msg && <div className="notice notice--ok">{msg}</div>}

      {/* ---------------- stage quick chips ---------------- */}
      <div className="stage-strip" role="group" aria-label="Quick stage filters">
        {quickStages.map((s) => {
          const n = counts(s.key);
          const active = (filters.status || '') === s.key;
          return (
            <button key={s.key} type="button"
              className={`stage-chip ${active ? 'is-on' : ''} ${n == null ? 'stage-chip--muted' : ''}`}
              onClick={() => set('status', s.key)}>
              {s.key && <span className="stage-chip__dot" style={{ background: STAGE_DOT[s.key] }} />}
              {s.label}{n != null && <small>{n}</small>}
            </button>
          );
        })}
      </div>

      {/* ---------------- search + filters toolbar ---------------- */}
      <div className="tool-bar">
        <span className="tb-ic" aria-hidden="true"><Search size={16} /></span>
        <input placeholder="Search ticket #, student, matric or email…" value={filters.q}
          onChange={(e) => set('q', e.target.value)} aria-label="Search complaints" />
        <select value={filters.category} onChange={(e) => set('category', e.target.value)} aria-label="Filter by service">
          <option value="">All services</option>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Show complaints from">
          <option value="">Any time</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="custom">Pick dates…</option>
        </select>
      </div>

      {when === 'custom' && (
        <div className="tool-bar" style={{ padding: '10px 14px' }}>
          <Filter size={15} style={{ color: 'var(--green)' }} aria-hidden="true" />
          <span style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--green-deep)' }}>From</span>
          <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} style={{ maxWidth: 160 }} />
          <span style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--green-deep)' }}>to</span>
          <input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} style={{ maxWidth: 160 }} />
          <button type="button" className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setWhen('')}>Clear dates</button>
        </div>
      )}

      {/* ---------------- queue ---------------- */}
      {!list && !error && (
        <div className="page-loading" role="status">
          <span className="page-loading__spinner" aria-hidden="true" />
          <strong>Please hold on while we fetch your complaints…</strong>
          <small>Filtering the queue with the options you chose.</small>
        </div>
      )}
      {list && list.length === 0 && (
        <div className="card empty-state">
          <div className="inbox-empty__art"><Inbox size={30} /></div>
          <strong>No complaints match</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>Nothing matches the filters you set.</p>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="tkt-list">
          {list.map((t) => (
            <div key={t.id} className={`tkt-row ${t.status === 'open' && !t.assigned_staff_id ? 'is-unattended' : ''}`}>
              <div className="cell-student">
                <div className="tkt-student">
                  <span className="tkt-avatar" aria-hidden="true">{initialsOf(t.student_name)}</span>
                  <div style={{ minWidth: 0 }}>
                    <span className="tkt-student__name">{t.student_name}</span>
                    <span className="tkt-student__matric">{t.matric_no || '—'}</span>
                  </div>
                </div>
              </div>
              <div className="cell-id">
                <span className="tkt-row__id">{t.ticket_number}</span>
                <span className="tkt-row__when">{fmtDateTime(t.created_at)}</span>
              </div>
              <div className="cell-issue tkt-issue">
                <span className="tkt-issue__service">{t.category || '—'}</span>
                <span className="tkt-issue__what">{t.issue}</span>
              </div>
              <div className="cell-stage">
                <span className={`tkt-stage tkt-stage--${t.status}`}>
                  <span className="tkt-stage__dot" aria-hidden="true" />
                  {STATUS_LABELS[t.status]}
                </span>
              </div>
              <div className="cell-officer">
                {t.assigned_staff ? (
                  <span className="tkt-officer">
                    {t.assigned_staff}
                    <small>
                      {t.attended_by_name && t.attended_by_name !== t.assigned_staff
                        ? `attended by ${t.attended_by_name}`
                        : 'not attended yet'}
                    </small>
                  </span>
                ) : t.attended_by_name ? (
                  <span className="tkt-officer">
                    {t.attended_by_name}
                    <small>attended (no hand-over)</small>
                  </span>
                ) : (
                  <span className="tkt-officer" style={{ color: 'var(--muted)' }}>Unassigned<small>nobody on it yet</small></span>
                )}
              </div>
              <div className="cell-assign">
                {isSuper && (
                  <select className="admin-assign" defaultValue={t.assigned_staff_id || ''}
                    aria-label={`Hand over ${t.ticket_number}`}
                    onChange={(e) => { if (e.target.value) assign(t.id, Number(e.target.value)); }}
                    style={{ maxWidth: '100%', fontSize: '.78rem' }}>
                    <option value="">{t.assigned_staff ? t.assigned_staff : 'Hand over…'}</option>
                    {staffList.filter((s) => s.id !== t.assigned_staff_id).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}{s.role === 'admin' ? ' (Super)' : s.role === 'senior' ? ' (Senior)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="cell-open">
                <Link className="tkt-row__open" to={`/admin/tickets/${t.id}`}>
                  Open <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
