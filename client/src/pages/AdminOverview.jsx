import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { api, useAuth, nigeriaGreeting, fmtDateTime } from '../auth.jsx';
import { STATUS_LABELS } from '../components/Layout.jsx';

const PIE_COLORS = ['#0b7a33', '#f7c600', '#2f6fd0', '#7c3aed', '#e0642f', '#0aa361'];

/** Trend windows — every option is a real query, never a cached picture. */
const RANGES = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'day', label: 'A single day' },
  { key: 'pick', label: 'Pick month / year' },
];

function TrendPill({ value, invert }) {
  if (value == null || Number.isNaN(value)) return null;
  const up = value > 0;
  const flat = value === 0;
  // For "solved", a rise is good; for "new complaints"/"escalations", a rise needs attention.
  const good = invert ? up : !up;
  const cls = flat ? 'trend-pill--flat' : good ? 'trend-pill--good' : 'trend-pill--warn';
  return (
    <span className={`trend-pill ${cls}`} title="Compared with the previous period of the same length">
      {flat ? '–' : up ? '▲' : '▼'} {Math.abs(value)}%
    </span>
  );
}

/**
 * Overview — the staff landing screen, built on one live /staff/overview call.
 * The trend chart follows the selected window (a day, a month, a year or a
 * custom range) and every figure is computed fresh from the database.
 */
export default function AdminOverview() {
  const { user } = useAuth();
  const isSuper = user?.role === 'admin';
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState('7d');
  const [pickDay, setPickDay] = useState(new Date().toISOString().slice(0, 10));
  const [pickMonth, setPickMonth] = useState(new Date().toISOString().slice(0, 7));
  const [pickYear, setPickYear] = useState(String(new Date().getFullYear()));
  const [pickWhich, setPickWhich] = useState('month'); // inside "pick"

  function query() {
    if (range === '30d') return '?span=30';
    if (range === 'month') return `?month=${new Date().toISOString().slice(0, 7)}`;
    if (range === 'year') return `?year=${new Date().getFullYear()}`;
    if (range === 'day') return `?day=${pickDay}`;
    if (range === 'pick') return pickWhich === 'month' ? `?month=${pickMonth}` : `?year=${pickYear}`;
    return '';
  }

  function load() {
    api(`/staff/overview${query()}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [range, pickDay, pickMonth, pickYear, pickWhich]);
  // Quiet refresh every minute so the numbers stay honest without a reload.
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [range, pickDay, pickMonth, pickYear, pickWhich]);

  const roleLabel = user?.role === 'admin' ? 'Super ICT Support' : user?.role === 'senior' ? 'Senior Engineer' : 'ICT Support Officer';
  const c = data?.counts;
  const t = data?.trends || {};

  const cards = [
    { n: c?.open, label: 'Open', icon: '🎫', to: '/admin/tickets?status=open', tone: 'ov-card--open', hint: 'waiting for the first look', trend: t.created, invert: true },
    { n: c?.inProgress, label: 'In Progress', icon: '⏳', to: '/admin/tickets?status=in_progress', tone: 'ov-card--progress', hint: 'officers are on these now' },
    { n: c?.waiting, label: 'Waiting for Student', icon: '💬', to: '/admin/tickets?status=waiting_student', tone: 'ov-card--waiting', hint: 'we asked, they have not answered' },
    { n: c?.escalated, label: 'Escalated', icon: '⬆', to: isSuper ? '/admin/tickets?status=escalated' : '/admin/escalations', tone: 'ov-card--escalated', hint: 'with the Senior Engineers', trend: t.escalated, invert: true },
    { n: c?.resolvedToday, label: 'Resolved Today', icon: '✅', to: '/admin/tickets?status=resolved', tone: 'ov-card--resolved', hint: 'every student has been told' },
  ];

  const quickActions = [
    ['🎫', 'View All Complaints', 'Every complaint, every stage', '/admin/tickets'],
    ['⬆', isSuper ? 'Escalated Queue' : 'My Escalated Queue', 'What the seniors are handling', isSuper ? '/admin/tickets?status=escalated' : '/admin/escalations'],
    ['💬', 'Student Questions', 'Live chats waiting for a reply', '/admin/inbox'],
    ['📊', 'Reports & Analytics', 'Any day, month or year', '/admin/analytics'],
  ];

  const activeLabel = RANGES.find((r) => r.key === range)?.label || 'Last 7 days';

  return (
    <>
      {/* ------------------------- welcome banner ------------------------- */}
      <div className="ov-banner mb">
        <div className="ov-banner__inner">
          <div>
            <span className="ov-banner__date">{nigeriaGreeting()}</span>
            <h2>{user?.fullName}</h2>
            <p>Here is your ICT Support desk at a glance — every figure below is live from the system, refreshed as students and officers act.</p>
          </div>
          <span className="ov-banner__role">🛡 {roleLabel}{user?.staffNo ? ` · ${user.staffNo}` : ''}</span>
        </div>
        <em className="ov-banner__motto">Service · Support · Solutions</em>
      </div>

      {error && <div className="notice notice--err mb">{error}</div>}

      <div className="ov-grid">
        {/* ============================ main column ============================ */}
        <div>
          {/* ------------------------ stat cards ------------------------ */}
          <div className="ov-cards mb">
            {cards.map((card) => (
              <button key={card.label} type="button" className={`ov-card ${card.tone}`} onClick={() => navigate(card.to)}>
                <span className="ov-card__ic">{card.icon}</span>
                <span className="ov-card__label">{card.label}</span>
                <span className="ov-card__n">{card.n ?? '–'}</span>
                <span className="ov-card__hint">{card.hint}</span>
              </button>
            ))}
          </div>

          {/* ------------------------ charts row ------------------------ */}
          <div className="ov-charts mb">
            <div className="card ov-chart">
              <div className="panel-head" style={{ marginBottom: 4 }}>
                <div>
                  <h3 className="panel-title" style={{ margin: 0 }}>Complaint trends</h3>
                  <p className="panel-sub" style={{ margin: 0 }}>
                    Live from the database — {data?.period?.label || activeLabel}, compared with the period before it.
                  </p>
                </div>
                <Link className="btn btn--outline btn--sm" to="/admin/analytics">Full reports →</Link>
              </div>

              {/* range selector — any day, month or year */}
              <div className="ov-range">
                <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Trend period">
                  {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                {range === 'day' && <input type="date" value={pickDay} onChange={(e) => setPickDay(e.target.value)} aria-label="Pick a day" />}
                {range === 'pick' && (
                  <>
                    <select value={pickWhich} onChange={(e) => setPickWhich(e.target.value)} aria-label="Month or year">
                      <option value="month">Month</option>
                      <option value="year">Year</option>
                    </select>
                    {pickWhich === 'month'
                      ? <input type="month" value={pickMonth} onChange={(e) => setPickMonth(e.target.value)} aria-label="Pick a month" />
                      : <input type="number" min="2020" max="2100" value={pickYear} onChange={(e) => setPickYear(e.target.value)} style={{ width: 96 }} aria-label="Pick a year" />}
                  </>
                )}
                <span className="badge badge--resolved">{data?.period?.label || activeLabel}</span>
              </div>

              {data && data.days.length === 0 && (
                <div className="empty-state" style={{ padding: '30px 10px' }}>
                  <div style={{ fontSize: '1.8rem' }}>🌱</div>
                  <strong>No complaints in this period</strong>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: '.84rem' }}>Pick a wider period above, or wait for the next one to arrive.</p>
                </div>
              )}
              {data && data.days.length > 0 && (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.days} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9db3a4" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#9db3a4" />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="created" name="New complaints" stroke="#2f6fd0" strokeWidth={2.4} dot={data.days.length <= 31 ? { r: 3 } : false} />
                    <Line type="monotone" dataKey="resolved" name="Solved" stroke="#0b7a33" strokeWidth={2.4} dot={data.days.length <= 31 ? { r: 3 } : false} />
                    <Line type="monotone" dataKey="escalated" name="Sent to seniors" stroke="#e0642f" strokeWidth={2.4} dot={data.days.length <= 31 ? { r: 3 } : false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {data && (
                <div className="ov-trendrow">
                  <div className="ov-trendrow__item">
                    <span>New complaints</span>
                    <strong>{t.createdNow ?? 0} <small className="muted">vs {t.createdPrev ?? 0} before</small></strong>
                    <TrendPill value={t.created} invert />
                  </div>
                  <div className="ov-trendrow__item">
                    <span>Solved</span>
                    <strong>{t.resolvedNow ?? 0} <small className="muted">vs {t.resolvedPrev ?? 0} before</small></strong>
                    <TrendPill value={t.resolved} />
                  </div>
                  <div className="ov-trendrow__item">
                    <span>Sent to seniors</span>
                    <strong>{t.escalatedNow ?? 0} <small className="muted">vs {t.escalatedPrev ?? 0} before</small></strong>
                    <TrendPill value={t.escalated} invert />
                  </div>
                </div>
              )}
            </div>

            <div className="card ov-chart">
              <h3 className="panel-title" style={{ margin: 0 }}>Complaints by service</h3>
              <p className="panel-sub" style={{ margin: 0 }}>Click a slice to see those complaints.</p>
              {data && data.categories.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={data.categories} dataKey="count" nameKey="name"
                      innerRadius={52} outerRadius={82} paddingAngle={2}
                      onClick={(entry) => {
                        const cat = data.categories.find((x) => x.name === entry.name);
                        if (cat) navigate(`/admin/tickets?q=${encodeURIComponent(entry.name)}`);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {data.categories.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="loading">{data ? 'Nothing to show yet.' : 'Loading…'}</div>}
              {data && data.categories.length > 0 && (
                <ul className="ov-legend">
                  {data.categories.map((cat, i) => (
                    <li key={cat.name}>
                      <button type="button" onClick={() => navigate(`/admin/tickets?q=${encodeURIComponent(cat.name)}`)}>
                        <span className="ov-legend__dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {cat.name}
                        <strong>{cat.pct}%</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* --------------------- latest complaints --------------------- */}
          <div className="panel-head">
            <div>
              <h3 className="panel-title">Latest complaints</h3>
              <p className="panel-sub">The newest ones from students — click a row to work on it.</p>
            </div>
            <Link className="btn btn--outline btn--sm" to="/admin/tickets">View all →</Link>
          </div>
          <div className="card">
            {!data && (
              <div className="page-loading" role="status">
                <span className="page-loading__spinner" aria-hidden="true" />
                <strong>Please hold on while we fetch your dashboard…</strong>
                <small>Every number is calculated live from the system.</small>
              </div>
            )}
            {data && data.recent.length === 0 && (
              <div className="empty-state">
                <div style={{ fontSize: '2rem' }}>📮</div>
                <strong>All quiet — nothing new right now</strong>
                <p className="muted" style={{ margin: '4px 0 10px' }}>When a student brings a complaint, it lands here first.</p>
              </div>
            )}
            {data && data.recent.length > 0 && (
              <div className="table-wrap mt">
                <table>
                  <thead>
                    <tr><th>Tracking ID</th><th>Student</th><th>Service</th><th>Stage</th><th>Officer</th><th>Logged</th><th></th></tr>
                  </thead>
                  <tbody>
                    {data.recent.map((row) => (
                      <tr key={row.id} className="row-link" onClick={() => navigate(`/admin/tickets/${row.id}`)} style={{ cursor: 'pointer' }}>
                        <td><strong>{row.ticket_number}</strong></td>
                        <td>{row.student_name}<br /><span className="muted" style={{ fontSize: '.8rem' }}>{row.matric_no}</span></td>
                        <td style={{ fontSize: '.84rem' }}>{row.category || '—'}</td>
                        <td><span className={`badge badge--${row.status}`}>{STATUS_LABELS[row.status]}</span></td>
                        <td className="muted">{row.assigned || 'Unassigned'}</td>
                        <td className="muted" style={{ fontSize: '.8rem' }}>{fmtDateTime(row.created_at)}</td>
                        <td>›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ============================ right rail ============================ */}
        <div className="ov-rail">
          <div className="card ov-quick">
            <h3 className="panel-title" style={{ margin: 0 }}>Quick actions</h3>
            {quickActions.map(([ic, label, hint, to]) => (
              <Link key={label} to={to} className="ov-quick__item">
                <span className="ov-quick__ic">{ic}</span>
                <span><strong>{label}</strong><small>{hint}</small></span>
                <span className="ov-quick__arrow">›</span>
              </Link>
            ))}
          </div>

          <div className="card ov-activity">
            <div className="panel-head" style={{ marginBottom: 4 }}>
              <h3 className="panel-title" style={{ margin: 0 }}>Recent activity</h3>
              <Link className="btn btn--outline btn--sm" to="/admin/audit">View all →</Link>
            </div>
            {!data && <div className="loading">Loading…</div>}
            {data && data.activity.length === 0 && <p className="muted">Nothing recorded yet.</p>}
            {data && data.activity.map((a, i) => (
              <div className="ov-activity__item" key={i}>
                <span className={`ov-activity__ic ov-activity__ic--${a.action.split('.')[0]}`}>•</span>
                <div>
                  <strong>{a.action}</strong>
                  {a.entity_type === 'ticket' && a.entity_id && (
                    <><br /><button type="button" className="ov-activity__link" onClick={() => navigate(`/admin/tickets/${a.entity_id}`)}>open complaint #{a.entity_id} →</button></>
                  )}
                  <small>{a.actor_name || 'System'} · {fmtDateTime(a.created_at)}</small>
                </div>
              </div>
            ))}
          </div>

          <div className="ov-brand">
            <div className="ov-brand__photo" />
            <div className="ov-brand__text">
              <strong>{roleLabel}</strong>
              <p>Supporting our students, keeping RUGIPO connected.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
