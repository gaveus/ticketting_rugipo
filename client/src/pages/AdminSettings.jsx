import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { User, ClipboardList, School, Megaphone, Star, ChevronDown, Reply, ArrowUp, ArrowUpDown, KeyRound, Ban, Check, ArrowLeftRight, Undo2 } from 'lucide-react';
import { api } from '../auth.jsx';

const TABS = [
  ['accounts', 'Staff accounts', User],
  ['catalogue', 'Support services', ClipboardList],
  ['masterdata', 'Faculties & departments', School],
  ['updates', 'Homepage updates', Megaphone],
];

/** Super ICT Support administration: accounts, services, master data. */
export default function AdminSettings() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'accounts';

  // ICT Support Staff and Senior Engineers see everything here read-only —
  // every add/edit/delete button is hidden and the server rejects their
  // writes anyway. Only Super ICT Support can act.
  const readOnly = user?.role !== 'admin';

  if (readOnly) {
    return (
      <>
        <h2 className="section__title">Administration</h2>
        <div className="notice notice--info">
          You can view everything on this page, but making changes is reserved for the Super ICT Support. If something here needs correcting, let them know.
        </div>
        <div className="chips mb" style={{ flexDirection: 'row', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map(([k, label, Ic]) => (
            <button key={k} type="button" className="chip"
              style={{ width: 'auto', display: 'inline-flex', padding: '8px 14px', borderColor: tab === k ? 'var(--green)' : 'var(--line)', background: tab === k ? 'var(--gold-soft)' : '#fff' }}
              onClick={() => setParams({ tab: k }, { replace: true })}>{Ic && <Ic size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />}<strong>{label}</strong></button>
          ))}
        </div>
        {tab === 'accounts' && <Accounts readOnly />}
        {tab === 'catalogue' && <Catalogue readOnly />}
        {tab === 'masterdata' && <MasterData readOnly />}
        {tab === 'updates' && <Updates readOnly />}
      </>
    );
  }

  return (
    <>
      <h2 className="section__title">Administration</h2>
      <p className="section__sub">Manage staff accounts, the support services students pick from, and the faculty/department lists.</p>

      <div className="chips mb" style={{ flexDirection: 'row', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map(([k, label, Ic]) => (
          <button key={k} type="button" className="chip"
            style={{ width: 'auto', display: 'inline-flex', padding: '8px 14px', borderColor: tab === k ? 'var(--green)' : 'var(--line)', background: tab === k ? 'var(--gold-soft)' : '#fff' }}
            onClick={() => setParams({ tab: k }, { replace: true })}>{Ic && <Ic size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />}<strong>{label}</strong></button>
        ))}
      </div>

      {tab === 'accounts' && <Accounts />}
      {tab === 'catalogue' && <Catalogue />}
      {tab === 'masterdata' && <MasterData />}
      {tab === 'updates' && <Updates />}
    </>
  );
}

/* --------------------------- homepage updates --------------------------- */

/** Post the announcements students see on the homepage Recent Updates band. */
function Updates({ readOnly = false } = {}) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ kind: 'announcement', title: '', body: '' });
  const [msg, setMsg] = useState({ ok: '', err: '' });

  function load() { api('/staff/admin/announcements').then((d) => setList(d.announcements)).catch((e) => setMsg({ ok: '', err: e.message })); }
  useEffect(load, []);

  async function post(e) {
    e.preventDefault();
    setMsg({ ok: '', err: '' });
    try {
      await api('/staff/admin/announcements', { method: 'POST', body: JSON.stringify(form) });
      setForm({ kind: 'announcement', title: '', body: '' });
      setMsg({ ok: 'Posted — it is on the homepage now.', err: '' });
      load();
    } catch (err) { setMsg({ ok: '', err: err.message }); }
  }

  async function remove(id) {
    if (!window.confirm('Remove this update from the homepage?')) return;
    await api(`/staff/admin/announcements/${id}`, { method: 'DELETE' });
    load();
  }

  const KINDS = [['announcement', 'Announcement'], ['update', 'Update'], ['maintenance', 'Maintenance']];

  return (
    <div className="card">
      <h3 className="panel-title">Post an update</h3>
      <p className="panel-sub">This appears in the Recent Updates section of the student homepage the moment you post it.</p>
      {readOnly ? (
        <div className="notice notice--info">Read-only — only Super ICT Support can post updates.</div>
      ) : (
      <form onSubmit={post} className="mt" style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
        <label className="field"><span>Kind</span>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field"><span>Title</span>
          <input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. ICT Support Service Hours" required />
        </label>
        <label className="field"><span>Details</span>
          <textarea value={form.body} maxLength={600} rows={3} onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="What students should know — plain words, no jargon." required />
        </label>
        <div>
          <button className="btn btn--navy">Post update</button>
        </div>
      </form>
      )}
      {msg.ok && <div className="notice notice--ok mt">{msg.ok}</div>}
      {msg.err && <div className="notice notice--err mt">{msg.err}</div>}

      <h3 className="panel-title mt">Live updates</h3>
      {!list && <div className="loading">Loading…</div>}
      {list && list.length === 0 && <p className="muted">Nothing posted yet — the homepage hides the section until the first update goes out.</p>}
      {list && list.length > 0 && (
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Kind</th><th>Title</th><th>Details</th><th>Posted</th><th></th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td><span className={`badge badge--news-${a.kind}`}>{a.kind}</span></td>
                  <td><strong>{a.title}</strong></td>
                  <td style={{ fontSize: '.84rem', maxWidth: 340 }}>{a.body}</td>
                  <td className="muted" style={{ fontSize: '.8rem' }}>{new Date(a.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</td>
                  <td>{!readOnly && <button type="button" className="btn btn--outline btn--sm menu-list__danger" onClick={() => remove(a.id)}>Delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ accounts ------------------------------ */

function Accounts({ readOnly = false } = {}) {
  const { user } = useAuth();
  const [staffList, setStaffList] = useState([]);
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'staff', staffNo: '', gender: '', phone: '', specialty: 'portal' });
  const [confirmSuper, setConfirmSuper] = useState(null); // { id, email, input }
  const [menuOpen, setMenuOpen] = useState(null); // staff id with open action menu
  const [confirmRole, setConfirmRole] = useState(null); // { staff, role, specialty } before a role change
  const [resetPw, setResetPw] = useState(null); // { staff, password } for password reset

  function load() { api('/staff/admin/staff').then((d) => setStaffList(d.staff)).catch((e) => setMsg({ ok: '', err: e.message })); }
  useEffect(load, []);

  async function createAccount(e) {
    e.preventDefault();
    setMsg({ ok: '', err: '' });
    try {
      const d = await api('/staff/admin/staff', { method: 'POST', body: JSON.stringify(form) });
      setMsg({ ok: `Account created for ${form.fullName} (${form.role === 'senior' ? `Senior Engineer — ${form.specialty === 'payment' ? 'Payment' : 'Portal'} complaints` : 'ICT Support Staff'}). Share the password securely.`, err: '' });
      setForm({ fullName: '', email: '', password: '', role: 'staff', staffNo: '', gender: '', phone: '', specialty: 'portal' });
      load();
    } catch (err) { setMsg({ ok: '', err: err.message }); }
  }

  async function act(path, body = {}) {
    setMsg({ ok: '', err: '' });
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      load();
      return true;
    } catch (err) { setMsg({ ok: '', err: err.message }); return false; }
  }

  const roleBadge = (r) => r === 'admin' ? 'Super ICT Support' : r === 'senior' ? 'Senior Engineer' : 'ICT Support Staff';

  if (readOnly) {
    return (
      <div className="card">
        <strong>All accounts ({staffList.length})</strong>
        <div className="notice notice--info" style={{ margin: '8px 0' }}>
          Read-only — only Super ICT Support can create or change accounts.
        </div>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {staffList.map((s) => (
                <tr key={s.id} style={!s.active ? { opacity: .55 } : undefined}>
                  <td><strong>{s.full_name}</strong><br />
                    <span className="muted" style={{ fontSize: '.78rem' }}>{s.email}{s.staff_no ? ` · ${s.staff_no}` : ''}</span></td>
                  <td><span className={`badge ${s.role === 'admin' ? 'badge--resolved' : s.role === 'senior' ? 'badge--in_progress' : 'badge--assigned'}`}>
                    {roleBadge(s.role)}</span>{s.role === 'senior' && s.specialty && (
                      <span className="muted" style={{ fontSize: '.74rem', display: 'block', marginTop: 2 }}>
                        handles {s.specialty === 'payment' ? 'payment' : 'portal'} complaints
                      </span>
                    )}</td>
                  <td>{s.active ? <span className="badge badge--resolved">Active</span> : <span className="badge badge--rejected">Disabled</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <>
      {msg.ok && <div className="notice notice--ok">{msg.ok}</div>}
      {msg.err && <div className="notice notice--err">{msg.err}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
        <div className="card">
          <strong>All accounts ({staffList.length})</strong>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {staffList.map((s) => (
                  <tr key={s.id} style={!s.active ? { opacity: .55 } : undefined}>
                    <td><strong>{s.full_name}</strong>{s.role === 'admin' && s.id !== user.id ? <Star size={12} style={{ verticalAlign: '-1px', marginLeft: 4, color: '#d97706' }} aria-label="Super ICT" /> : ''}<br />
                      <span className="muted" style={{ fontSize: '.78rem' }}>{s.email}{s.staff_no ? ` · ${s.staff_no}` : ''}</span></td>
                    <td><span className={`badge ${s.role === 'admin' ? 'badge--resolved' : s.role === 'senior' ? 'badge--in_progress' : 'badge--assigned'}`}>
                      {roleBadge(s.role)}</span>{s.role === 'senior' && s.specialty && (
                        <span className="muted" style={{ fontSize: '.74rem', display: 'block', marginTop: 2 }}>
                          handles {s.specialty === 'payment' ? 'payment' : 'portal'} complaints
                        </span>
                      )}</td>
                    <td>{s.active ? <span className="badge badge--resolved">Active</span> : <span className="badge badge--rejected">Disabled</span>}</td>
                    <td>
                      {s.id === user.id ? (
                        <span className="muted" style={{ fontSize: '.8rem' }}>You</span>
                      ) : s.role === 'admin' ? (
                        <span className="muted" style={{ fontSize: '.8rem' }}>Protected</span>
                      ) : (
                        <div style={{ position: 'relative' }}>
                          <button type="button" className="btn btn--outline btn--sm"
                            aria-haspopup="menu" aria-expanded={menuOpen === s.id}
                            onClick={() => setMenuOpen(menuOpen === s.id ? null : s.id)}>
                            Actions <ChevronDown size={13} style={{ verticalAlign: '-2px', marginLeft: 3 }} />
                          </button>
                          {menuOpen === s.id && (
                            <div className="menu-list" role="menu" onMouseLeave={() => setMenuOpen(null)}>
                              <button role="menuitem" type="button"
                                onClick={() => { setMenuOpen(null); setConfirmRole({ staff: s, role: s.role === 'senior' ? 'staff' : 'senior', specialty: s.specialty || 'portal' }); }}>
                                {s.role === 'senior'
                                  ? <><Reply size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Return to ICT Support</>
                                  : <><ArrowUp size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Make Senior Engineer</>}
                              </button>
                              {s.role === 'senior' && (
                                <button role="menuitem" type="button"
                                  onClick={() => { setMenuOpen(null); act(`/staff/admin/staff/${s.id}/specialty`, { specialty: s.specialty === 'payment' ? 'portal' : 'payment' }); }}>
                                  <ArrowLeftRight size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Move to {s.specialty === 'payment' ? 'portal' : 'payment'} desk
                                </button>
                              )}
                              <button role="menuitem" type="button"
                                onClick={() => { setMenuOpen(null); setConfirmSuper({ id: s.id, email: s.email, input: '' }); }}>
                                <Star size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Grant Super ICT Support
                              </button>
                              <button role="menuitem" type="button"
                                onClick={() => { setMenuOpen(null); setResetPw({ staff: s, password: '' }); }}>
                                <KeyRound size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Reset their password
                              </button>
                              <button role="menuitem" type="button" className="menu-list__danger"
                                onClick={() => { setMenuOpen(null); act(`/staff/admin/staff/${s.id}/active`, { active: !s.active }); }}>
                                {s.active ? <><Ban size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Disable this account</> : <><Check size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Enable this account</>}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '.8rem' }}>
            <Star size={12} style={{ verticalAlign: '-2px', marginRight: 4, color: '#d97706' }} />Super ICT Support can sign in, assign any ticket, create accounts and promote others.
          </p>
        </div>

        <div className="card">
          <strong>Create an account</strong>
          <p className="muted" style={{ fontSize: '.85rem' }}>
            ICT Support handles tickets; Senior Engineers handle escalations. There is no public sign-up.
          </p>
          <form onSubmit={createAccount}>
            <label className="field"><span>Role</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">ICT Support Staff</option>
                <option value="senior">Senior Engineer</option>
              </select>
            </label>
            {form.role === 'senior' && (
              <label className="field"><span>What will they handle?</span>
                <select value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })}>
                  <option value="portal">Portal complaints — login, registration, results, receipt/printing errors (no payment issue), CBT, admission…</option>
                  <option value="payment">Payment complaints — debited but not reflecting, expired links, receipts showing how the debit happened…</option>
                </select>
              </label>
            )}
            <label className="field"><span>Full name</span>
              <input value={form.fullName} required onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </label>
            <div className="form-grid">
              <label className="field"><span>Staff ID</span>
                <input value={form.staffNo} placeholder="ICT/RGP/0xx" onChange={(e) => setForm({ ...form, staffNo: e.target.value })} />
              </label>
              <label className="field"><span>Phone</span>
                <input value={form.phone} placeholder="080…" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
            </div>
            <label className="field"><span>Gender</span>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">Select gender…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label className="field"><span>Email</span>
              <input type="email" value={form.email} required onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="field"><span>Password <small>(min 8 chars — share securely)</small></span>
              <input type="password" value={form.password} minLength={8} required autoComplete="new-password"
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
            <button className="btn btn--navy">Create account</button>
          </form>
        </div>
      </div>

      {confirmRole && (
        <div className="card mt" style={{ borderLeft: '4px solid var(--green)' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{confirmRole.role === 'senior' ? <><ArrowUp size={16} /> Make Senior Engineer</> : <><Undo2 size={16} /> Return to ICT Support</>}</strong>
          <p className="muted" style={{ fontSize: '.88rem' }}>
            {confirmRole.role === 'senior'
              ? `${confirmRole.staff.full_name} will work escalated complaints. Choose the desk — escalations are routed by it.`
              : `${confirmRole.staff.full_name} will return to first-line ICT Support duties.`}
          </p>
          {confirmRole.role === 'senior' && (
            <label className="field"><span>Which complaints will they handle?</span>
              <select value={confirmRole.specialty}
                onChange={(e) => setConfirmRole({ ...confirmRole, specialty: e.target.value })}>
                <option value="portal">Portal complaints — login, registration, results, receipt/printing errors (no payment issue), CBT, admission…</option>
                <option value="payment">Payment complaints — debited but not reflecting, expired links, receipts showing how the debit happened…</option>
              </select>
            </label>
          )}
          <div className="row">
            <button className="btn btn--navy btn--sm"
              onClick={async () => {
                if (await act(`/staff/admin/staff/${confirmRole.staff.id}/role`, { role: confirmRole.role, specialty: confirmRole.specialty })) {
                  setMsg({ ok: 'Role updated.', err: '' });
                  setConfirmRole(null);
                }
              }}>
              Confirm
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setConfirmRole(null)}>Cancel</button>
          </div>
        </div>
      )}

      {resetPw && (
        <div className="card mt" style={{ borderLeft: '4px solid var(--gold)' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><KeyRound size={16} /> Reset password for {resetPw.staff.full_name}</strong>
          <p className="muted" style={{ fontSize: '.88rem' }}>
            Choose a new password for <strong>{resetPw.staff.email}</strong>. Share it privately —
            they can change it from My Profile after signing in.
          </p>
          <div className="row">
            <input type="text" placeholder="New password (8+ chars, letters &amp; numbers)" value={resetPw.password}
              onChange={(e) => setResetPw({ ...resetPw, password: e.target.value })} style={{ maxWidth: 320 }} />
            <button className="btn btn--navy btn--sm" disabled={resetPw.password.length < 8}
              onClick={async () => {
                if (await act(`/staff/admin/staff/${resetPw.staff.id}/reset-password`, { password: resetPw.password })) {
                  setMsg({ ok: `Password reset for ${resetPw.staff.email}. They can sign in with the new one now.`, err: '' });
                  setResetPw(null);
                }
              }}>
              Set password
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setResetPw(null)}>Cancel</button>
          </div>
        </div>
      )}

      {confirmSuper && (
        <div className="card mt" style={{ borderLeft: '4px solid var(--gold)' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Star size={16} /> Grant Super ICT Support</strong>
          <p className="muted" style={{ fontSize: '.88rem' }}>
            This gives <strong>{confirmSuper.email}</strong> full powers: assigning any ticket, creating accounts,
            and promoting others. Type their email to confirm.
          </p>
          <div className="row">
            <input placeholder={confirmSuper.email} value={confirmSuper.input}
              onChange={(e) => setConfirmSuper({ ...confirmSuper, input: e.target.value })} style={{ maxWidth: 320 }} />
            <button className="btn btn--navy btn--sm" disabled={confirmSuper.input !== confirmSuper.email}
              onClick={async () => { if (await act(`/staff/admin/staff/${confirmSuper.id}/promote-super`, { confirm: confirmSuper.input })) { setMsg({ ok: 'Promoted to Super ICT Support.', err: '' }); setConfirmSuper(null); } }}>
              Confirm promotion
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setConfirmSuper(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------------- service catalogue ---------------------------- */

function Catalogue({ readOnly = false } = {}) {
  const [cats, setCats] = useState([]);
  const [msg, setMsg] = useState('');

  function load() {
    api('/staff/admin/master-data').then((d) => setCats(d.categories)).catch((e) => setMsg(e.message));
  }
  useEffect(load, []);

  return (
    <div className="card">
      <strong>ICT service catalogue ({cats.length} services)</strong>
      <p className="muted" style={{ fontSize: '.85rem' }}>These power the student complaint form — categories, guided questions and issue types.</p>
      {msg && <div className="notice notice--err">{msg}</div>}
      <div className="table-wrap mt">
        <table>
          <thead><tr><th>Service</th><th>Guided questions</th><th>Issues</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} style={!c.active ? { opacity: .55 } : undefined}>
                <td><strong>{c.name}</strong><br /><span className="muted" style={{ fontSize: '.8rem' }}>{c.description}</span></td>
                <td>{(c.guided_fields || []).length || '—'}</td>
                <td>{c.issue_count}</td>
                <td>{c.active ? <span className="badge badge--resolved">Active</span> : <span className="badge badge--rejected">Hidden</span>}</td>
                <td>
                  {!readOnly ? (
                  <button className="btn btn--outline btn--sm"
                    onClick={async () => {
                      try {
                        await api(`/staff/admin/master-data/category/${c.id}`, {
                          method: 'PATCH', body: JSON.stringify({ active: !c.active }),
                        });
                        load();
                      } catch (err) { setMsg(err.message || 'Could not update the service.'); }
                    }}>
                    {c.active ? 'Hide' : 'Show'}
                  </button>
                  ) : <span className="muted" style={{ fontSize: '.78rem' }}>view only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------- master data ----------------------------- */

function MasterData({ readOnly = false } = {}) {
  const [data, setData] = useState({ faculties: [], departments: [] });
  const [form, setForm] = useState({ name: '', facultyId: '', kind: 'academic' });
  const [facultyName, setFacultyName] = useState('');
  const [msg, setMsg] = useState({ ok: '', err: '' });

  function load() { api('/staff/admin/master-data').then(setData).catch((e) => setMsg({ ok: '', err: e.message })); }
  useEffect(load, []);

  async function addFaculty(e) {
    e.preventDefault(); setMsg({ ok: '', err: '' });
    try {
      await api('/staff/admin/faculties', { method: 'POST', body: JSON.stringify({ name: facultyName }) });
      setMsg({ ok: `Faculty “${facultyName}” added.`, err: '' }); setFacultyName(''); load();
    } catch (err) { setMsg({ ok: '', err: err.message }); }
  }

  async function addDepartment(e) {
    e.preventDefault(); setMsg({ ok: '', err: '' });
    try {
      await api('/staff/admin/departments', { method: 'POST', body: JSON.stringify(form) });
      setMsg({ ok: `Department “${form.name}” added.`, err: '' }); setForm({ ...form, name: '' }); load();
    } catch (err) { setMsg({ ok: '', err: err.message }); }
  }

  return (
    <>
      {msg.ok && <div className="notice notice--ok">{msg.ok}</div>}
      {msg.err && <div className="notice notice--err">{msg.err}</div>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)' }}>
        <div className="card">
          <strong>Add to master data</strong>
          {readOnly && <div className="notice notice--info">Read-only — only Super ICT Support can change these lists.</div>}
          <form onSubmit={addFaculty} className="mt" hidden={readOnly}>
            <label className="field"><span>New faculty / school</span>
              <input value={facultyName} required placeholder="e.g. Legal Studies"
                onChange={(e) => setFacultyName(e.target.value)} />
            </label>
            <button className="btn btn--outline btn--sm">Add faculty</button>
          </form>
          <form onSubmit={addDepartment} className="mt" hidden={readOnly}>
            <label className="field"><span>Department belongs to</span>
              <select value={form.facultyId} required onChange={(e) => setForm({ ...form, facultyId: e.target.value })}>
                <option value="">Select faculty…</option>
                {data.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Type</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="academic">Academic department</option>
                <option value="unit">Administrative unit</option>
                <option value="center">Center</option>
              </select>
            </label>
            <label className="field"><span>Department name</span>
              <input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <button className="btn btn--outline btn--sm">Add department</button>
          </form>
        </div>

        <div className="card">
          <strong>Faculties ({data.faculties.length})</strong>
          <div className="mt" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {data.faculties.map((f) => (
              <div key={f.id} style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                <div className="row row--between">
                  <strong>{f.name}</strong>
                  <span className="muted" style={{ fontSize: '.8rem' }}>{f.department_count} departments {f.active ? '' : '· hidden'}</span>
                </div>
                <div className="muted" style={{ fontSize: '.8rem', marginTop: 2 }}>
                  {data.departments.filter((d) => d.faculty_id === f.id).map((d) => d.name + (d.kind !== 'academic' ? ` (${d.kind})` : '')).join(' · ') || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
