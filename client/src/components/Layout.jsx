import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const STATUS_LABELS = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In Progress',
  waiting_student: 'Waiting for Student', escalated: 'Escalated',
  resolved: 'Resolved', closed: 'Closed', rejected: 'Rejected',
};
export { STATUS_LABELS };

const Caret = () => (
  <svg className="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Navbar structure:
 *   [logo]  Home | Student Support ▾ | ICT Portal ▾ (staff) | [user ▾ / Sign in]
 * Dropdowns open on click, close on outside click / Escape / navigation.
 * Mobile (≤ 920px): hamburger → full-width panel with the same groups as accordions.
 */
export default function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const staff = user && ['staff', 'senior', 'admin'].includes(user.role);
  const isSenior = staff && ['senior', 'admin'].includes(user.role);

  const [openMenu, setOpenMenu] = useState(null); // 'support' | 'user'
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef(null);

  // Close everything when the route changes.
  useEffect(() => { setOpenMenu(null); setMobileOpen(false); }, [location.pathname]);

  // Outside click + Escape.
  useEffect(() => {
    function onDocClick(e) {
      if (navRef.current && !navRef.current.contains(e.target)) setOpenMenu(null);
    }
    function onKey(e) {
      if (e.key === 'Escape') { setOpenMenu(null); setMobileOpen(false); }
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const toggle = (name) => setOpenMenu((m) => (m === name ? null : name));

  const inSupport = ['/new-ticket', '/track', '/contact'].includes(location.pathname);

  const firstName = user ? user.fullName.split(/\s+/)[0] : '';
  const initials = user ? user.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : '';
  const roleLabel = user
    ? (user.role === 'admin' ? 'Administrator' : user.role === 'senior' ? 'Senior Engineer' : 'ICT Support Staff')
    : '';

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="site-header__brand">
            <img className="site-header__logo" src="/rugipo-logo.png" alt="RUGIPO logo" />
            <span className="site-header__title">
              RUGIPO ICT Support
              <small>Rufus Giwa Polytechnic, Owo</small>
            </span>
          </Link>

          <button
            className="nav__toggle"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              {mobileOpen
                ? <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                : <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            </svg>
          </button>

          <nav className={`nav ${mobileOpen ? 'is-mobile-open' : ''}`} ref={navRef} aria-label="Main">
            <div className="nav__item">
              <NavLink to="/" end className="nav__link">Home</NavLink>
            </div>

            {/* ---------------- Student Support ---------------- */}
            <div className={`nav__item ${openMenu === 'support' ? 'is-open' : ''}`}>
              <button type="button" className={`nav__link ${inSupport ? 'is-active' : ''}`}
                aria-haspopup="true" aria-expanded={openMenu === 'support'}
                onClick={() => toggle('support')}>
                Student Support <Caret />
              </button>
              <div className="nav__menu">
                <div className="nav__menu-label">Student services</div>
                <NavLink to="/new-ticket">Log a Complaint<small>No account needed — get a Tracking ID instantly</small></NavLink>
                <NavLink to="/track">Track a Ticket<small>Follow progress with your Tracking ID + email</small></NavLink>
                <NavLink to="/contact">Talk to ICT<small>A question? Get an answer by email</small></NavLink>
              </div>
            </div>

            {/* ---------------- Need help CTA ---------------- */}
            <Link to="/contact" className="nav__help-btn">Need Help?</Link>

            {/* ---------------- Account (staff sees a quiet portal link) ---------------- */}
            {staff ? (
              <div className={`nav__item nav__item--end ${openMenu === 'user' ? 'is-open' : ''}`}>
                <button type="button" className="nav__link nav__user-btn"
                  aria-haspopup="true" aria-expanded={openMenu === 'user'}
                  onClick={() => toggle('user')}>
                  <span className="nav__avatar">{initials}</span>
                  <span className="nav__user-name">{firstName}</span>
                  <Caret />
                </button>
                <div className="nav__menu">
                  <div className="nav__menu-label">Signed in</div>
                  <div className="nav__user-role">
                    <strong style={{ color: 'var(--green-deep)' }}>{user.fullName}</strong><br />
                    {roleLabel} · {user.email}
                  </div>
                  <hr />
                  <NavLink to="/admin/dashboard">Open my dashboard<small>Go to the staff portal</small></NavLink>
                  <button type="button" className="nav__signout" onClick={signOut}>Sign out</button>
                </div>
              </div>
            ) : null}
          </nav>
        </div>
      </header>

      <Outlet />

      <footer className="site-footer">
        <div className="site-footer__inner">
          <div className="row">
            <img src="/rugipo-logo.png" alt="" />
            <div>
              <strong>Rufus Giwa Polytechnic, Owo — ICT Directorate</strong><br />
              ICT Support Ticketing System · Advancement Through Technology<br />
              <span className="site-footer__contact">
                ✉ <a href="mailto:ecampus@rugipo.edu.ng">ecampus@rugipo.edu.ng</a>
                 · ☎ +234803*******
              </span>
            </div>
          </div>
          <div className="site-footer__meta">
            Log a complaint → get your Tracking ID → we email you when it's solved.<br />
            <Link to="/privacy" style={{ fontSize: '.82rem' }}>Privacy &amp; your data</Link>
            <small style={{ display: 'block', marginTop: 4 }}>Rufus Giwa Polytechnic, Owo ICT Directorate © 2026 || Powered by ToltemTech All rights reserved.</small>
          </div>
        </div>
      </footer>
    </>
  );
}
