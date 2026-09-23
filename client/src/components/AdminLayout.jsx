import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { useAuth, api, fmtDateTime } from '../auth.jsx';
import IdleLock from './IdleLock.jsx';
import { LayoutDashboard, Ticket, Mail, MessageCircle, ArrowUp, ArrowRight, ArrowLeft, TrendingUp, User, ShieldCheck, School, ClipboardList, Megaphone, Settings, Inbox } from 'lucide-react';

// Supabase Realtime — when configured (production), new student questions
// refresh the sidebar/bell badges instantly. Otherwise the 45s poll covers it.
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supaBadges = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } }) : null;

const KIND_ICONS = { new_ticket: Ticket, student_reply: MessageCircle, escalation: ArrowUp, inbox: Mail };

/**
 * Notification bell — a real dropdown feed of the newest things that need an
 * officer's attention (new complaints, student replies, escalations, waiting
 * questions). Items not opened since the last time the bell was opened count
 * towards the red badge. Polls every 30s like the rest of the shell.
 */
function NotificationBell({ badges }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [seenAt, setSeenAt] = useState(() => {
    try { return Number(localStorage.getItem('rugipo.bell.seenAt')) || 0; } catch { return 0; }
  });
  const ref = React.useRef(null);

  useEffect(() => {
    let alive = true;
    function pull() { api('/staff/notifications').then((d) => { if (alive) setItems(d.items || []); }).catch(() => {}); }
    pull();
    const t = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  function openBell() {
    const next = !open;
    setOpen(next);
    if (next) {
      // Opening the panel is what clears the red badge — remember "now".
      const now = Date.now();
      setSeenAt(now);
      try { localStorage.setItem('rugipo.bell.seenAt', String(now)); } catch { /* ignore */ }
    }
  }

  const fresh = items.filter((n) => new Date(n.at).getTime() > seenAt).length;
  const count = Math.max(fresh || 0, badges?.unread || 0);

  return (
    <div className="bell-wrap" ref={ref}>
      <button type="button" className="topbar-bell" onClick={openBell}
        aria-label={`Notifications${count ? ` — ${count} new` : ''}`} aria-expanded={open}>
        <BellIcon />
        {count > 0 && <span className="topbar-bell__count">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-panel__head">
            <strong>Notifications</strong>
            <small>newest first · live</small>
          </div>
          <div className="bell-panel__list">
            {items.length === 0 && (
              <div className="bell-panel__empty">
                <Inbox size={22} />
                <strong>All caught up</strong>
                <p>When students write, reply or a complaint is escalated, you'll see it here.</p>
              </div>
            )}
            {items.map((n) => (
              <Link key={n.id} to={n.to} className={`bell-panel__item ${new Date(n.at).getTime() > seenAt ? 'is-new' : ''}`}
                onClick={() => setOpen(false)}>
                <span className="bell-panel__ic">{(() => { const Ic = KIND_ICONS[n.kind]; return Ic ? <Ic size={14} /> : '•'; })()}</span>
                <span className="bell-panel__body">
                  <strong>{n.title}</strong>
                  <small>{n.detail}</small>
                  <time>{fmtDateTime(n.at)}</time>
                </span>
              </Link>
            ))}
          </div>
          <Link to="/admin/inbox" className="bell-panel__foot" onClick={() => setOpen(false)}>
            Open student questions <ArrowRight size={13} style={{ verticalAlign: '-2px' }} />
          </Link>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0-6 6v3.3c0 .5-.2 1-.5 1.4L4 16h16l-1.5-2.3a2.5 2.5 0 0 1-.5-1.4V9a6 6 0 0 0-6-6Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9.8 19a2.3 2.3 0 0 0 4.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Staff portal layout: a single flat sidebar menu + top bar.
 * Mobile: sidebar becomes a slide-in drawer with a bottom quick nav.
 */
export default function AdminLayout() {
  const { user, ready, signOut } = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [badges, setBadges] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { setDrawer(false); }, [location.pathname, location.search]);

  // Live count pills for the sidebar + bell. Quiet refresh every 45s, instant
  // nudge from Supabase when a new student question arrives (production).
  useEffect(() => {
    if (!user || !['staff', 'senior', 'admin'].includes(user.role)) return;
    let alive = true;
    function pull() { api('/staff/badges').then((b) => { if (alive) setBadges(b); }).catch(() => {}); }
    pull();
    const t = setInterval(pull, 45000);
    let channel = null;
    if (supaBadges) {
      channel = supaBadges.channel('inbox:badges');
      channel.on('broadcast', { event: 'refresh' }, () => pull()).subscribe();
    }
    return () => { alive = false; clearInterval(t); if (channel && supaBadges) { try { supaBadges.removeChannel(channel); } catch { /* ignore */ } } };
  }, [user, location.pathname]);

  const isSenior = ['senior', 'admin'].includes(user?.role);
  const isAdmin = user?.role === 'admin';

  // One flat menu — Heritage: the navigation list is short, keep it together.
  const navItems = React.useMemo(() => [
    { to: '/admin/dashboard', search: '', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/tickets', search: '', label: 'All complaints', icon: Ticket, count: badges?.open },
    { to: '/admin/inbox', search: '', label: 'Student questions', icon: Mail, count: badges?.unread },
    ...(isSenior ? [{ to: '/admin/escalations', search: '', label: 'Escalations', icon: ArrowUp, count: badges?.escalated }] : []),
    { to: '/admin/analytics', search: '', label: 'Reports', icon: TrendingUp },
    ...(isSenior ? [
      { to: '/admin/settings', search: '?tab=accounts', label: 'Staff accounts', icon: User },
      { to: '/admin/audit', search: '', label: 'Activity log', icon: ShieldCheck },
      { to: '/admin/settings', search: '?tab=masterdata', label: 'Faculties & departments', icon: School },
      { to: '/admin/settings', search: '?tab=catalogue', label: 'Support services', icon: ClipboardList },
      { to: '/admin/settings', search: '?tab=updates', label: 'Homepage updates', icon: Megaphone },
    ] : []),
    { to: '/admin/settings', search: '', label: 'Settings', icon: Settings, end: true },
  ], [isSenior, badges]);

  /** Active = same path AND same tab query (Administration tabs share one path). */
  function isActive(it) {
    if (location.pathname !== it.to) return false;
    if (it.end) return location.pathname === it.to && !location.search;
    if (it.search) return location.search === it.search;
    return true;
  }

  if (!ready) return <div className="loading">Loading…</div>;
  if (!user) return <Gate />;
  if (!['staff', 'senior', 'admin'].includes(user.role)) return <Gate />;

  const roleLabel = user.role === 'admin' ? 'Super ICT Support' : user.role === 'senior' ? (user.specialty === 'payment' ? 'Payment Gateway Provider' : 'Portal Support Engineer') : 'ICT Support Staff';
  const displayName = user.fullName || user.email || 'Staff';
  const initials = displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  // First-login gate: new staff must set their own password + details before
  // they can work on complaints. They can still visit My Profile.
  const onProfile = location.pathname === '/admin/profile';
  const setupIncomplete = !!(user.mustChangePassword || (user.profileComplete === false));
  if (setupIncomplete && !onProfile) {
    return <ProfileGate user={user} />;
  }

  // Top-bar title = active item's label.
  const activeItem = navItems.find(isActive);

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${drawer ? 'is-open' : ''}`}>
        <div className="admin-sidebar__brand">
          <img src="/rugipo-logo.png" alt="RUGIPO logo" />
          <div>
            <strong>ICT Staff Portal</strong>
            <small>RUGIPO · Owo</small>
          </div>
        </div>

        {/* Identity card — photo, name, role, staff ID (always visible). */}
        <Link to="/admin/profile" className="admin-who" title="Open my profile">
          {user.profileImage
            ? <img className="admin-who__photo" src={user.profileImage.startsWith('http') ? user.profileImage : `/api/auth/me/photo?v=${Date.now()}`}
                alt={displayName} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <span className="admin-who__photo admin-who__photo--empty">{initials}</span>}
          <strong className="admin-who__name">{displayName}</strong>
          <span className="admin-who__role">{roleLabel}</span>
          {user.staffNo && <small className="admin-who__meta">Staff ID: {user.staffNo}</small>}
          {user.role === 'senior' && user.specialty && (
            <small className="admin-who__meta">{user.specialty === 'payment' ? 'Payment complaints' : 'Portal complaints'}</small>
          )}        </Link>

        <nav className="admin-sidebar__nav" aria-label="Portal">
          {navItems.map((it) => (
            <Link key={it.label + it.search} to={it.to + it.search}
              className={`admin-sidebar__link ${isActive(it) ? 'is-active' : ''}`}>
              <span className="admin-sidebar__icon" aria-hidden="true"><it.icon size={16} strokeWidth={2} /></span>
              {it.label}
              {Number.isInteger(it.count) && it.count > 0 && <span className="admin-badge" aria-label={`${it.count}`}>{it.count > 99 ? '99+' : it.count}</span>}
            </Link>
          ))}
        </nav>

        <div className="admin-sidebar__foot">
          <Link to="/admin/profile" className={`admin-sidebar__link ${location.pathname === '/admin/profile' ? 'is-active' : ''}`}><User size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />My profile</Link>
          <Link to="/" className="admin-sidebar__link"><ArrowLeft size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Back to student site</Link>
          <button className="admin-sidebar__link admin-sidebar__signout" onClick={() => { signOut(); nav('/admin'); }}>
            Sign out
          </button>
        </div>
      </aside>
      {drawer && <div className="admin-drawer-backdrop" onClick={() => setDrawer(false)} />}

      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-topbar__burger" onClick={() => setDrawer((d) => !d)} aria-label="Toggle menu">
            <svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <div className="admin-topbar__title">{activeItem?.label || 'Portal'}</div>

          {/* Global search → complaint list. The icon is a real submit button. */}
          <form className="topbar-search" onSubmit={(e) => { e.preventDefault(); if (search.trim()) { nav(`/admin/tickets?q=${encodeURIComponent(search.trim())}`); setSearch(''); } }}>
            <button type="submit" className="topbar-search__btn" aria-label="Search complaints" title="Search">
              <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="m13.5 13.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tracking ID, matric no or name…"
              aria-label="Search complaints"
            />
            {search && (
              <button type="button" className="topbar-search__clear" aria-label="Clear search" onClick={() => setSearch('')}>×</button>
            )}
          </form>

          <div className="admin-topbar__right">
            <NotificationBell badges={badges} />
            <div className="admin-topbar__user">
              {user.profileImage
                ? <img className="topbar-photo" src={user.profileImage.startsWith('http') ? user.profileImage : '/api/auth/me/photo'}
                    alt="" onError={(e) => { e.currentTarget.outerHTML = `<span class=\\\"nav__avatar\\\">${initials}</span>`; }} />
                : <span className="nav__avatar">{initials}</span>}
              <div className="admin-topbar__who">
                <strong>{displayName}</strong>
                <small>{roleLabel}{user.staffNo ? ` · ${user.staffNo}` : ''}</small>
              </div>
            </div>
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>

        {/* Idle auto-lock — hides everything after 15 quiet minutes until the
            officer re-enters their password. */}
        <IdleLock />

        {/* Mobile bottom nav — the five things staff do most. */}
        <nav className="admin-bottomnav" aria-label="Quick menu">
          <Link to="/admin/dashboard" className={location.pathname === '/admin/dashboard' ? 'is-active' : ''}>
            <span className="bn-ic"><LayoutDashboard size={16} /></span>Home</Link>
          <Link to="/admin/tickets" className={location.pathname.startsWith('/admin/tickets') && !location.pathname.includes('my-tickets') ? 'is-active' : ''}>
            <span className="bn-ic"><Ticket size={16} /></span>Complaints</Link>
          <Link to="/admin/inbox" className={location.pathname === '/admin/inbox' ? 'is-active' : ''}>
            <span className="bn-ic"><Mail size={16} /></span>Questions</Link>
          {isSenior && (
            <Link to="/admin/escalations" className={location.pathname === '/admin/escalations' ? 'is-active' : ''}>
              <span className="bn-ic"><ArrowUp size={16} /></span>Escalated</Link>
          )}
          <Link to="/admin/settings" className={location.pathname === '/admin/settings' ? 'is-active' : ''}>
            <span className="bn-ic"><Settings size={16} /></span>Settings</Link>
        </nav>
      </div>
    </div>
  );
}

function ProfileGate({ user }) {
  // Say exactly what is still missing, so the gate never lies about done work.
  const needsPassword = !!user.mustChangePassword;
  const needsDetails = user.profileComplete === false;
  const todo = [
    needsPassword && 'set your own password',
    needsDetails && 'add your gender and phone number',
  ].filter(Boolean).join(' and ');
  return (
    <div className="admin-shell">
      <div className="admin-main" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <section className="section container" style={{ maxWidth: 560 }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <img src="/rugipo-logo.png" alt="" style={{ width: 54, height: 54, borderRadius: '50%', padding: 3, border: '2px solid var(--gold)' }} />
            <h1 className="section__title" style={{ marginTop: 10 }}>Welcome, {(user.fullName || 'there').split(/\s+/)[0]}</h1>
            <p className="section__sub">
              {todo
                ? <>Your account needs one more step before it is ready: please {todo}.</>
                : <>Finishing up…</>}
            </p>
            <Link className="btn btn--navy" to="/admin/profile">Set up my profile →</Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function Gate() {
  return (
    <section className="section container" style={{ maxWidth: 520 }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <img src="/rugipo-logo.png" alt="" style={{ width: 54, height: 54, borderRadius: '50%', padding: 3, border: '2px solid var(--gold)' }} />
        <h1 className="section__title" style={{ marginTop: 10 }}>ICT Staff Portal</h1>
        <p className="section__sub">Sign in or create a staff account to continue.</p>
        <Link className="btn btn--navy" to="/admin">Go to sign in</Link>
      </div>
    </section>
  );
}
