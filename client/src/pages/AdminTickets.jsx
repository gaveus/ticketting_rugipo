import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useAuth, fmtDateTime } from '../auth.jsx';
import { Check, Inbox } from 'lucide-react';
import { STATUS_LABELS } from '../components/Layout.jsx';

const STATUS_OPTIONS = ['', 'open', 'assigned', 'in_progress', 'waiting_student', 'escalated', 'resolved', 'closed', 'rejected'];

/**
 * Complaint queue — search, stage, service, and a simple "When" selector.
 * Row times are Nigeria time; "Waiting on us" isolates complaints nobody
 * has picked up yet.
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
      // Open the date pickers with the last 30 days pre-filled so there's
      // always something sensible to adjust.
      const back = new Date(now.getTime() - 30 * 86400_000);
      next.set('from', filters.from || fmtDay(back)); next.set('to', filters.to || fmtDay(now));
    }
    if (w) next.set('when', w); else next.delete('when');
    setParams(next, { replace: true });
  }

  function load() {
    const qp = new URLSearchParams(params);
    if (mine) qp.set('staff', 'mine');
    // Deep links from Reports (a clicked bar / slice) use day / month / year.
    if (filters.day) qp.set('day', filters.day);
    if (filters.month) qp.set('month', filters.month);
    if (filters.year) qp.set('year', filters.year);
    api(`/staff/tickets?${qp}`).then((d) => setList(d.tickets)).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [params, mine]);
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

  return (
    <>
      <div className="panel-head">
        <div>
          <h2 className="section__title" style={{ margin: 0 }}>{mine ? 'Assigned to me' : 'All complaints'}</h2>
          <p className="panel-sub">{list ? `${list.length} shown · all times are Nigeria time` : 'Loading…'}</p>
        </div>
        <button type="button" className={`btn btn--sm ${filters.unattended ? 'btn--gold' : 'btn--outline'}`}
          onClick={() => set('unattended', filters.unattended ? '' : '1')}>
          {filters.unattended ? <><Check size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />Showing unattended</> : 'Show unattended only'}
        </button>
      </div>

      {(filters.day || filters.month || filters.year) && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderLeft: '4px solid var(--gold)' }}>
          <strong style={{ color: 'var(--green-deep)' }}>
            {filters.day ? 'One day: ' + filters.day : filters.month ? 'One month: ' + filters.month : 'One year: ' + filters.year}
          </strong>
          <span className="muted" style={{ fontSize: '.84rem' }}>(opened from the Reports page)</span>
          <button type="button" className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }}
            onClick={() => { const n = new URLSearchParams(params); n.delete('day'); n.delete('month'); n.delete('year'); setParams(n, { replace: true }); }}>
            Show everything
          </button>
        </div>
      )}

      {error && <div className="notice notice--err">{error}</div>}
      {msg && <div className="notice notice--ok">{msg}</div>}

      <div className="filters">
        <input placeholder="Search ticket #, student, matric or email…" value={filters.q}
          onChange={(e) => set('q', e.target.value)} style={{ minWidth: 220 }} />
        <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s ? STATUS_LABELS[s] : 'All stages'}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => set('category', e.target.value)}>
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
        <div className="daterange row" style={{ gap: 8, alignItems: 'center', margin: '10px 0 14px' }}>
          <span style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--green-deep)' }}>From</span>
          <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
          <span style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--green-deep)' }}>to</span>
          <input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setWhen('')}>Clear dates</button>
        </div>
      )}

      {!list && !error && (
        <div className="page-loading" role="status">
          <span className="page-loading__spinner" aria-hidden="true" />
          <strong>Please hold on while we fetch your complaints…</strong>
          <small>Filtering the queue with the options you chose.</small>
        </div>
      )}
      {list && list.length === 0 && (
        <div className="card empty-state">
          <div style={{ fontSize: '2rem', color: 'var(--green)' }}><Inbox size={32} /></div>
          <strong>No complaints match</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>Nothing matches the filters you set.</p>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Ticket</th><th>Student</th><th>Problem</th><th>Logged (Lagos time)</th><th>Stage</th><th>Attended by</th><th>Hand over to</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className={t.status === 'open' && !t.assigned_staff_id ? 'row-unattended' : ''}>
                  <td><strong>{t.ticket_number}</strong></td>
                  <td>{t.student_name}<br /><span className="muted" style={{ fontSize: '.8rem' }}>{t.matric_no}</span></td>
                  <td>{t.category}<br /><span className="muted" style={{ fontSize: '.82rem' }}>{t.issue}</span></td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '.84rem' }}>{fmtDateTime(t.created_at)}</td>
                  <td><span className={`badge badge--${t.status}`}>{STATUS_LABELS[t.status]}</span></td>
                  <td style={{ fontSize: '.84rem' }}>
                    {t.assigned_staff ? (
                      <>
                        <strong>{t.assigned_staff}</strong>
                        {t.attended_by_name && t.attended_by_name !== t.assigned_staff && (
                          <><br /><span className="muted" style={{ fontSize: '.78rem' }}>attended by {t.attended_by_name}</span></>
                        )}
                        {!t.attended_by_name && (
                          <><br /><span className="muted" style={{ fontSize: '.78rem' }}>not attended yet</span></>
                        )}
                      </>
                    ) : t.attended_by_name ? (
                      <>
                        <strong>{t.attended_by_name}</strong>
                        <br /><span className="muted" style={{ fontSize: '.78rem' }}>attended (no hand-over)</span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <select className="admin-assign" defaultValue={t.assigned_staff_id || ''} aria-label={`Hand over ${t.ticket_number}`}
                      onChange={(e) => { if (e.target.value) assign(t.id, Number(e.target.value)); }}>
                      <option value="">{t.assigned_staff ? t.assigned_staff : 'Unassigned — choose…'}</option>
                      {staffList.filter((s) => s.id !== t.assigned_staff_id).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name}{s.role === 'admin' ? ' (Super)' : s.role === 'senior' ? ' (Senior)' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td><Link className="btn btn--outline btn--sm" to={`/admin/tickets/${t.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
