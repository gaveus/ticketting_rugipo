import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api, useAuth, fmtDate, fmtDateTime } from '../auth.jsx';
import { Download, Image as ImageIcon, FileImage } from 'lucide-react';
import { STATUS_LABELS } from '../components/Layout.jsx';

const STATUS_COLORS = {
  open: '#d97706', assigned: '#2563eb', in_progress: '#7c3aed',
  waiting_student: '#ca8a04', escalated: '#c2410c', resolved: '#0f7a3d', closed: '#5a6478', rejected: '#991b1b',
};
const GREEN_DEEP = '#07421f';
const GOLD = '#f7c600';

/** Rich tooltip shared by both charts. */
function ChartTip({ active, payload, label, nameOf }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const name = nameOf ? nameOf(p.payload) : (p.name || label);
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', boxShadow: '0 6px 18px rgba(7,66,31,.12)', fontSize: '.84rem' }}>
      <strong>{name}</strong><br />
      <span style={{ color: p.payload?.fill || p.fill || 'var(--green)' }}>●</span> {p.value} complaint{p.value === 1 ? '' : 's'}
    </div>
  );
}

/**
 * Pie chart (complaints by stage) — real Recharts pie, clickable slices,
 * legend below doubles as a click target for touch devices.
 */
function StagePie({ segments, onSlice }) {
  if (segments.length === 0) return <p className="muted mt">Nothing in this period.</p>;
  return (
    <div className="mt" style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={segments} dataKey="value" nameKey="name" innerRadius={62} outerRadius={100}
            paddingAngle={2} stroke="#fff" strokeWidth={2}
            onClick={(entry) => onSlice && onSlice(entry)}
            cursor={onSlice ? 'pointer' : 'default'}
            label={({ name, value }) => (value / segments.reduce((a, s) => a + s.value, 0) >= 0.08 ? `${name.split(' ')[0]} ${value}` : null)}
            labelLine={false}>
            {segments.map((s) => <Cell key={s.key} fill={s.fill} />)}
          </Pie>
          <Tooltip content={<ChartTip />} />
          <Legend
            formatter={(v, entry) => (
              <span style={{ cursor: onSlice ? 'pointer' : 'default', color: 'var(--ink)', fontSize: '.82rem' }}
                onClick={() => onSlice && onSlice(entry.payload)}>
                {v} — {entry.payload.value}
              </span>
            )} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Trend chart — smooth area (histogram feel) of complaints over time,
 * clickable points open that day/hour/month in the complaints list.
 */
function TrendArea({ data, onBar, labelOf }) {
  if (data.length === 0) return <p className="muted mt">Nothing in this period.</p>;
  const chartData = data.map((d) => ({ ...d, label: labelOf(d) }));
  return (
    <div className="mt" style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
          onClick={(state) => {
            const idx = state?.activeTooltipIndex;
            if (idx != null && onBar) onBar(chartData[idx]);
          }}>
          <defs>
            <linearGradient id="greenFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f7a3d" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#0f7a3d" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--line)' }}
            interval="preserveStartEnd" minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTip nameOf={(p) => p.label} />} />
          <Area type="monotone" dataKey="n" name="Complaints" stroke="#0f7a3d" strokeWidth={2.5}
            fill="url(#greenFill)" dot={{ r: 3, fill: '#0f7a3d' }} activeDot={{ r: 5 }}
            cursor={onBar ? 'pointer' : 'default'} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function StaffAnalytics() {
  const { user } = useAuth();
  const staff = user && ['staff', 'senior', 'admin'].includes(user.role);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  // Period selection: quick mode + concrete values.
  const [mode, setMode] = useState('30d'); // day | month | year | range | 30d
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const captureRef = useRef(null);

  function query() {
    const p = new URLSearchParams();
    if (mode === 'day' && day) p.set('day', day);
    if (mode === 'month' && month) p.set('month', month);
    if (mode === 'year' && year) p.set('year', year);
    if (mode === 'range' && from && to) { p.set('from', from); p.set('to', to); }
    return p.toString();
  }

  function load() {
    if (!staff) return;
    const qs = query();
    api(`/staff/analytics${qs ? `?${qs}` : ''}`).then(setData).catch((e) => setError(e.message));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [staff, mode, day, month, year, from, to]);

  if (!staff) return null;
  if (error) return <section className="section container"><div className="notice notice--err">{error}</div></section>;
  if (!data) return (
    <div className="page-loading" role="status">
      <span className="page-loading__spinner" aria-hidden="true" />
      <strong>Please hold on while we fetch your details…</strong>
      <small>Calculating every figure for the period you chose.</small>
    </div>
  );

  const total = data.totals?.total || 0;
  const resolved = data.totals?.resolved || 0;
  const rate = total ? Math.round((resolved / total) * 100) : 0;
  const escTotal = data.escalations || 0;
  const escRate = total ? Math.round((escTotal / total) * 100) : 0;
  const escPayment = data.escalationsByKind?.find((k) => k.specialty === 'payment')?.n || 0;
  const escPortal = data.escalationsByKind?.find((k) => k.specialty === 'portal')?.n || 0;
  const avg = data.avgResolutionHours;

  const statusSegments = data.byStatus
    .map((s) => ({ key: s.status, name: STATUS_LABELS[s.status] || s.status, value: s.n, fill: STATUS_COLORS[s.status] || '#999' }))
    .sort((a, b) => b.value - a.value);
  const maxCat = Math.max(1, ...data.byCategory.map((d) => d.n));
  const maxStaff = Math.max(1, ...data.staffWorkload.map((d) => d.n));
  const paymentTotal = data.payments.reduce((a, p) => a + p.n, 0);
  const trendLabel = (d) => (String(d.day).includes(':') ? `hour ${d.day}` : fmtDate(d.day));

  /** Which list does a donut slice / bar open? */
  function statusLink(status) {
    const p = new URLSearchParams(query());
    p.set('status', status);
    return `/admin/tickets?${p.toString()}`;
  }
  function dayLink(dayValue) {
    const d = String(dayValue);
    if (/^\d{4}-\d{2}$/.test(d)) return `/admin/tickets?month=${d}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `/admin/tickets?from=${d}&to=${d}`;
    return '/admin/tickets';
  }

  // ---------------------------- exports ----------------------------
  function fileName(ext) {
    const stamp = mode === 'day' ? day : mode === 'month' ? month : mode === 'year' ? year : mode === 'range' ? `${from}_${to}` : 'last-30-days';
    return `RUGIPO-ICT-Report-${stamp}.${ext}`;
  }

  async function exportExcel() {
    // Real .xls with the RUGIPO heading band — opens in Excel with colours.
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const th = (s) => `<th style="background:${GREEN_DEEP};color:#ffffff;padding:6px 10px;border:1px solid #0d5c31;text-align:left;">${esc(s)}</th>`;
    const td = (s) => `<td style="padding:5px 10px;border:1px solid #d7e2d9;">${esc(s)}</td>`;
    const sectionTitle = (s) => `<tr><td colspan="2" style="background:${GOLD};color:${GREEN_DEEP};font-weight:bold;padding:6px 10px;border:1px solid #d9b400;">${esc(s)}</td></tr>`;
    const rows = [];
    rows.push(`<tr><td colspan="2" style="background:${GREEN_DEEP};color:#ffffff;font-size:16px;font-weight:bold;padding:10px;">RUFUS GIWA POLYTECHNIC, OWO — ICT SUPPORT</td></tr>`);
    rows.push(`<tr><td colspan="2" style="background:#eaf3ec;padding:6px 10px;font-size:12px;">Complaints Report · ${esc(data.period.label)} · generated ${esc(fmtDateTime(new Date().toISOString()))} · by ${esc(user.fullName)}</td></tr>`);
    rows.push(sectionTitle('Summary'));
    rows.push(`<tr>${th('Measure')}${th('Value')}</tr>`);
    const kv = [
      ['Total complaints', total],
      ['Solved or closed', resolved],
      ['Still open', data.totals?.stillOpen ?? 0],
      ['Waiting for first look', data.totals?.unattended ?? 0],
      ['With Specialist Engineers now', data.totals?.nowEscalated ?? 0],
      ['Ever escalated', escTotal],
      ['Escalated — payment desk', escPayment],
      ['Escalated — portal desk', escPortal],
      ['Students who complained', data.totals?.uniqueStudents ?? 0],
      ['Average time to solve', avg != null ? fmtHours(avg) : '—'],
      ['Quickest solve', data.fastestResolutionHours != null ? fmtHours(data.fastestResolutionHours) : '—'],
      ['Slowest solve', data.slowestResolutionHours != null ? fmtHours(data.slowestResolutionHours) : '—'],
    ];
    kv.forEach(([k, v]) => rows.push(`<tr>${td(k)}${td(v)}</tr>`));
    rows.push(sectionTitle('By stage'));
    rows.push(`<tr>${th('Stage')}${th('Count')}</tr>`);
    statusSegments.forEach((s) => rows.push(`<tr>${td(STATUS_LABELS[s.label] || s.label)}${td(s.value)}</tr>`));
    rows.push(sectionTitle('By service'));
    rows.push(`<tr>${th('Service')}${th('Count')}</tr>`);
    data.byCategory.forEach((c) => rows.push(`<tr>${td(c.name)}${td(c.n)}</tr>`));
    rows.push(sectionTitle('Officers'));
    rows.push(`<tr>${th('Officer')}${th('Handling')}${th('Solved')}</tr>`);
    data.staffWorkload.forEach((s) => rows.push(`<tr>${td(s.staff)}${td(s.n)}${td(s.done ?? '')}</tr>`));
    rows.push(sectionTitle('Departments'));
    rows.push(`<tr>${th('Department')}${th('Count')}</tr>`);
    data.byDepartment.forEach((d) => rows.push(`<tr>${td(d.dept)}${td(d.n)}</tr>`));
    rows.push(sectionTitle('Payment check'));
    rows.push(`<tr>${th('Verification')}${th('Count')}</tr>`);
    data.payments.forEach((p) => rows.push(`<tr>${td(p.verification_status.replace('_', ' '))}${td(p.n)}</tr>`));
    rows.push(`<tr><td colspan="2" style="padding:8px;font-size:11px;color:#5a6478;">RUGIPO ICT Support Ticketing System — official report. Counts cover ${esc(data.period.label)}.</td></tr>`);

    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Report</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head><body><table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:12px;">${rows.join('')}</table></body></html>`;
    const url = URL.createObjectURL(new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName('xls'); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function exportPNG() {
    const node = captureRef.current;
    if (!node) return;
    setBusy('image');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#f4f7f4', useCORS: true });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = fileName('png'); a.click();
    } catch { setError('Could not build the image — try again.'); }
    finally { setBusy(''); }
  }

  async function exportJPG() {
    const node = captureRef.current;
    if (!node) return;
    setBusy('image-jpg');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#f4f7f4', useCORS: true });
      const url = canvas.toDataURL('image/jpeg', 0.92);
      const a = document.createElement('a');
      a.href = url; a.download = fileName('jpg'); a.click();
    } catch { setError('Could not build the image — try again.'); }
    finally { setBusy(''); }
  }


  return (
    <section className="section container container--wide">
      <div className="panel-head">
        <div>
          <h2 className="section__title" style={{ margin: 0 }}>Reports</h2>
          <p className="panel-sub">Pick a day, a month, a whole year or your own range — every figure on this page follows your choice.</p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn btn--outline btn--sm ${busy ? 'btn--busy' : ''}`} disabled={!!busy} onClick={exportExcel}><Download size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Excel</button>
          <button className={`btn btn--outline btn--sm ${busy ? 'btn--busy' : ''}`} disabled={!!busy} onClick={exportPNG}>{busy === 'image' ? 'Building…' : <><ImageIcon size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />PNG</>}</button>
          <button className={`btn btn--outline btn--sm ${busy ? 'btn--busy' : ''}`} disabled={!!busy} onClick={exportJPG}>{busy === 'image-jpg' ? 'Building…' : <><FileImage size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />JPG</>}</button>
        </div>
      </div>

      {/* -------------------------- period picker -------------------------- */}
      <div className="card mb period-bar">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ color: 'var(--green-deep)' }}>Showing:</strong>
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Report period">
            <option value="30d">Last 30 days</option>
            <option value="day">One day</option>
            <option value="month">One month</option>
            <option value="year">One year</option>
            <option value="range">My own range</option>
          </select>
          {mode === 'day' && <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />}
          {mode === 'month' && <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}
          {mode === 'year' && <input type="number" min="2024" max="2100" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 110 }} />}
          {mode === 'range' && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="muted">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
          <span className="badge badge--resolved" style={{ marginLeft: 'auto' }}>{data.period.label}</span>
        </div>
      </div>

      {/* ================= everything inside the capture ================= */}
      <div ref={captureRef} className="report-capture">
        <div className="report-brandbar">
          <div className="report-brandbar__logo">RUGIPO</div>
          <div>
            <strong>Rufus Giwa Polytechnic, Owo — ICT Support</strong>
            <div>Complaints Report · {data.period.label}</div>
          </div>
          <div className="report-brandbar__meta">
            generated {fmtDate(new Date().toISOString())} · by {user.fullName}
          </div>
        </div>

        {/* ------------------------------ KPI cards ------------------------------ */}
        <div className="grid grid--4 mb" style={{ marginTop: 14 }}>
          <div className="stat stat--green">
            <div className="stat__n">{avg != null ? fmtHours(avg) : '—'}</div>
            <div className="stat__label">Average time to solve</div>
            <div className="stat__hint">
              {data.fastestResolutionHours != null
                ? `Quickest ${fmtHours(data.fastestResolutionHours)} · slowest ${fmtHours(data.slowestResolutionHours)}`
                : 'Nothing solved in this period yet.'}
            </div>
          </div>
          <div className="stat">
            <div className="stat__n">{rate}%</div>
            <div className="stat__label">Solved share</div>
            <div className="stat__hint">{resolved} of {total} complaints in this period.</div>
          </div>
          <div className="stat stat--urgent">
            <div className="stat__n">{escRate}%</div>
            <div className="stat__label">Sent to seniors</div>
            <div className="stat__hint">{escPayment} payment · {escPortal} portal escalations.</div>
          </div>
          <div className="stat stat--gold">
            <div className="stat__n">{data.totals?.unattended ?? 0}</div>
            <div className="stat__label">Waiting for first look</div>
            <div className="stat__hint">{data.totals?.uniqueStudents ?? 0} different students complained.</div>
          </div>
        </div>

        {/* ---------------------- trend + donut ---------------------- */}
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 16 }}>
          <div className="card">
            <strong>When complaints arrived</strong>
            <TrendArea data={data.byDay} onBar={(d) => window.open(dayLink(d.day), '_self')} labelOf={trendLabel} />
            <p className="muted" style={{ fontSize: '.78rem', margin: '6px 0 0' }}>Tap any point on the line to open those complaints.</p>
          </div>

          <div className="card">
            <strong>Where they stand now</strong>
            <StagePie segments={statusSegments} onSlice={(s) => s.key && window.open(statusLink(s.key), '_self')} />
            <p className="muted" style={{ fontSize: '.78rem', margin: '6px 0 0' }}>Tap a slice or a legend row to open those complaints.</p>
          </div>
        </div>

        {/* --------------------- services + workload --------------------- */}
        <div className="grid grid--3" style={{ marginTop: 16 }}>
          <div className="card">
            <strong>Most reported services</strong>
            {data.byCategory.length === 0 && <p className="muted mt">Nothing in this period.</p>}
            {data.byCategory.map((c) => (
              <Link key={c.id} to={`/admin/tickets?category=${c.id}`}
                style={{ display: 'block', marginBottom: 9, textDecoration: 'none', color: 'inherit' }}>
                <div className="row row--between" style={{ fontSize: '.84rem' }}>
                  <span>{c.name}</span><strong>{c.n}</strong>
                </div>
                <div className="hbar"><div style={{ width: `${(c.n / maxCat) * 100}%` }} /></div>
              </Link>
            ))}
          </div>

          <div className="card">
            <strong>Officers on duty</strong>
            <p className="muted" style={{ fontSize: '.78rem', margin: '2px 0 8px' }}>Complaints each officer handled in this period.</p>
            {data.staffWorkload.length === 0 && <p className="muted">None yet.</p>}
            {data.staffWorkload.map((s) => (
              <div key={s.staff} style={{ marginBottom: 9 }}>
                <div className="row row--between" style={{ fontSize: '.84rem' }}>
                  <span>{s.staff}</span><strong>{s.n} <small className="muted">({s.done ?? 0} solved)</small></strong>
                </div>
                <div className="hbar"><div style={{ width: `${(s.n / maxStaff) * 100}%`, background: 'var(--gold)' }} /></div>
              </div>
            ))}
          </div>

          <div className="card">
            <strong>Payment complaints check-up</strong>
            <p className="muted" style={{ fontSize: '.78rem', margin: '2px 0 8px' }}>{paymentTotal} with payment evidence.</p>
            {data.payments.length === 0 && <p className="muted">None in this period.</p>}
            {data.payments.map((p) => (
              <div key={p.verification_status} className="row row--between payline">
                <span className={`badge badge--${p.verification_status}`}>{p.verification_status.replace('_', ' ')}</span>
                <strong>{p.n}</strong>
              </div>
            ))}
            <div className="kv mt">
              <div><span>Escalated — payment desk</span><strong>{escPayment}</strong></div>
              <div><span>Escalated — portal desk</span><strong>{escPortal}</strong></div>
              <div><span>Students getting updates</span><strong>{data.subscribers}</strong></div>
            </div>
          </div>
        </div>

        {/* --------------------- departments + levels --------------------- */}
        <div className="grid grid--3" style={{ marginTop: 16 }}>
          <div className="card">
            <strong>Most affected departments</strong>
            <ul className="muted mt" style={{ paddingLeft: 18 }}>
              {data.byDepartment.slice(0, 6).map((d) => <li key={d.dept}>{d.dept} — <strong>{d.n}</strong></li>)}
            </ul>
          </div>
          <div className="card">
            <strong>By faculty / school</strong>
            <ul className="muted mt" style={{ paddingLeft: 18 }}>
              {data.byFaculty.slice(0, 6).map((d) => <li key={d.faculty}>{d.faculty} — <strong>{d.n}</strong></li>)}
            </ul>
          </div>
          <div className="card">
            <strong>Level &amp; study mode</strong>
            <ul className="muted mt" style={{ paddingLeft: 18 }}>
              {data.byLevelMode.slice(0, 6).map((d) => (
                <li key={`${d.lvl}-${d.mode}`}>{d.lvl === '(none)' ? 'Unspecified' : d.lvl} · {d.mode === 'PART_TIME' ? 'Part-Time' : d.mode === 'FULL_TIME' ? 'Full-Time' : d.mode} — <strong>{d.n}</strong></li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function fmtHours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Number(h).toFixed(1)} hr`;
  return `${Math.round(h / 24)} days`;
}
