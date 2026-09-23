import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../auth.jsx';
import { Zap, ShieldCheck, Users, ArrowRight, Search, MessageCircle, LifeBuoy, Clock, Mail, Phone, MapPin, Globe, ArrowUpRight, Sparkles, GraduationCap, Monitor, Check, Timer, ClipboardList, Settings2 } from 'lucide-react';

/** Small helper: adds .in when the element scrolls into view (one-shot). */
function Reveal({ children, delay = 0, as: Tag = 'div', className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { el.classList.add('in'); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

export default function Home() {
  const nav = useNavigate();
  const [categories, setCategories] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [showAllUpdates, setShowAllUpdates] = useState(false);
  // homepage track widget
  const [tn, setTn] = useState('');
  const [em, setEm] = useState('');
  const [trackMsg, setTrackMsg] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/meta').then((m) => setCategories(m.categories)).catch(() => {});
    api('/announcements').then((d) => setUpdates(d.announcements || [])).catch(() => setUpdates([]));
  }, []);

  async function checkStatus(e) {
    e.preventDefault();
    setTrackMsg(null); setBusy(true);
    try {
      await api('/tickets/track', {
        method: 'POST',
        body: JSON.stringify({ ticketNumber: tn.trim(), email: em.trim() }),
      });
      nav(`/track?number=${encodeURIComponent(tn.trim())}&email=${encodeURIComponent(em.trim())}`);
    } catch (err) {
      // fall back to the public status-only lookup so the student still learns something
      try {
        const q = await api(`/track/${encodeURIComponent(tn.trim().toUpperCase())}`);
        setTrackMsg({ ok: false, text: `${q.ticketNumber} exists but that email doesn't match it — open Track a Ticket and use the exact email you logged the complaint with.` });
      } catch {
        setTrackMsg({ ok: false, text: 'No complaint matches that Tracking ID. Double-check it — it looks like RGP-2026-A0001.' });
      }
    } finally { setBusy(false); }
  }

  return (
    <>
      {/* ------------------------------- hero ------------------------------- */}
      <section className="hero">
        <div className="hero__inner container">
          <div className="hero__copy">
            <span className="hero__badge">Rufus Giwa Polytechnic, Owo</span>
            <h1>We're Here to <em className="hero__accent">Help</em></h1>
            <p>
              Report ICT issues, track your complaints and get the support you need —
              <strong> quickly and easily</strong>. Log it in under a minute, get a Tracking ID
              instantly, and hear from us the moment it's solved.
            </p>
            <div className="hero__chips">
              <span className="chip chip--glass"><Zap size={15} aria-hidden="true" />Fast response times</span>
              <span className="chip chip--glass"><ShieldCheck size={15} aria-hidden="true" />Secure &amp; reliable</span>
              <span className="chip chip--glass"><Users size={15} aria-hidden="true" />Professional support team</span>
            </div>
            <div className="hero__actions">
              <Link className="btn btn--gold" to="/new-ticket"><Zap size={15} style={{ verticalAlign: '-2px' }} /> Log a Complaint <ArrowRight size={15} style={{ verticalAlign: '-2px' }} /></Link>
              <Link className="btn btn--ghost" to="/track"><Search size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Track Your Complaint</Link>
            </div>
          </div>
          <div className="hero__photo">
            <img src="/rugipo-gate.png" alt="Rufus Giwa Polytechnic main gate, Owo" />
            <span className="hero__photo-chip">
              <MapPin size={14} aria-hidden="true" />
              <span><strong>ICT Support Unit</strong><small>Advancement Through Technology</small></span>
            </span>
          </div>
        </div>
      </section>

      {/* ----------------- one clean band: track + help together ----------------- */}
      <section className="section container" style={{ paddingBottom: 26 }}>
        <Reveal>
          <div className="home-trackband">
            <div className="home-trackband__form">
              <h3><Search size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Track Your Complaint</h3>
              <p className="muted">Enter your Tracking ID and the email you used — we'll show you exactly where things stand.</p>
              <form onSubmit={checkStatus} className="home-trackband__fields">
                <input value={tn} onChange={(e) => setTn(e.target.value)} placeholder="Tracking ID — e.g. RGP-2026-A0001" required aria-label="Tracking ID" />
                <input type="email" value={em} onChange={(e) => setEm(e.target.value)} placeholder="Your email address" required aria-label="Email address" />
                <button className="btn btn--navy" disabled={busy}>{busy ? 'Checking…' : 'Check Status'}</button>
              </form>
              {trackMsg && (
                <div className={`notice ${trackMsg.ok ? 'notice--ok' : 'notice--err'}`}>{trackMsg.text}</div>
              )}
            </div>
            <div className="home-trackband__help">
              <div className="home-help__ic"><LifeBuoy size={20} /></div>
              <h3>Need Immediate Help?</h3>
              <p><Clock size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Mon – Fri, 8:00 AM – 5:00 PM</p>
              <p><Mail size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />ecampus@rugipo.edu.ng</p>
              <p><Phone size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />+234803*******</p>
              <p><MapPin size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />ICT Directorate, RUGIPO, Owo</p>
              <Link to="/contact" className="btn btn--outline btn--sm">Message the team →</Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ------------- how it works + portal panel, one composed row ------------- */}
      <section id="how-it-works" className="section container" style={{ paddingTop: 8 }}>
        <div className="how-grid">
          <div className="how-grid__steps">
            <Reveal>
              <h2 className="section__title">How it works</h2>
              <p className="section__sub">Three simple steps — no sign-up, no password, no stress.</p>
            </Reveal>
            <Reveal delay={80}>
              <div className="steps-cols">
                <div className="step-col">
                  <div className="step-col__head"><span className="step-col__num">1</span><span className="step-col__ic"><ClipboardList size={18} /></span></div>
                  <strong>Tell us what happened</strong>
                  <p>Your name, matric number and a short description of the problem. It takes less than a minute.</p>
                  <Link to="/new-ticket" className="steps-flow__cta">Start a complaint <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></Link>
                </div>
                <div className="step-col">
                  <div className="step-col__head"><span className="step-col__num">2</span><span className="step-col__ic"><Settings2 size={18} /></span></div>
                  <strong>Keep your Tracking ID</strong>
                  <p>It appears the moment you finish — something like RGP-2026-A0001 — and a copy goes to your email.</p>
                  <Link to="/track" className="steps-flow__cta">See how tracking works <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></Link>
                </div>
                <div className="step-col">
                  <div className="step-col__head"><span className="step-col__num">3</span><span className="step-col__ic"><Mail size={18} /></span></div>
                  <strong>Relax and get updates</strong>
                  <p>ICT picks it up and emails you at every important step — especially when it's SOLVED.</p>
                  <a href="#updates" className="steps-flow__cta">Read recent updates <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a>
                </div>
              </div>
            </Reveal>
          </div>
          <Reveal delay={120} className="how-grid__aside">
            <div className="portal-panel">
              <div className="portal-panel__top">
                <span className="portal-panel__art" aria-hidden="true">
                  {/* Hand-coded laptop illustration — chat bubble rides IN FRONT of the screen, top-right */}
                  <svg viewBox="0 0 100 70" role="img" aria-label="Laptop with a support chat bubble">
                    {/* laptop screen */}
                    <rect x="20" y="12" width="54" height="38" rx="6" fill="#0b3d1f" />
                    <rect x="24" y="16" width="46" height="30" rx="3" fill="#ffffff" />
                    {/* conversation on screen: student question left, ICT reply right */}
                    <rect x="28" y="21" width="18" height="6" rx="3" fill="#dcebe2" />
                    <rect x="28" y="30" width="24" height="6" rx="3" fill="#dcebe2" />
                    <rect x="46" y="39" width="20" height="6" rx="3" fill="#f7c600" />
                    {/* laptop base */}
                    <path d="M14 52 H80 L86 63 Q87 66 83 66 H11 Q7 66 8 63 Z" fill="#0b3d1f" />
                    <rect x="38" y="56" width="18" height="3.2" rx="1.6" fill="#3f7a58" />
                    {/* chat bubble — drawn last so it sits IN FRONT, overlapping the screen's top-right */}
                    <path d="M74 24 l-7 9 12 -4 z" fill="#1d7a4a" />
                    <rect x="62" y="2" width="34" height="24" rx="10" fill="#1d7a4a" />
                    <circle cx="72" cy="14" r="2.6" fill="#ffffff" />
                    <circle cx="79" cy="14" r="2.6" fill="#ffffff" />
                    <circle cx="86" cy="14" r="2.6" fill="#ffffff" />
                  </svg>
                </span>
                <div>
                  <strong>Visit the official school portal</strong>
                  <p>The ICT Support desk you are on now handles complaints. For registration, fees payment and everything else, use the main E-Campus website below.</p>
                </div>
              </div>
              <a className="portal-panel__cta" href="https://ecampus.rugipo.edu.ng" target="_blank" rel="noopener noreferrer">
                <Globe size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Go to E-Campus Portal <ArrowUpRight size={15} style={{ verticalAlign: '-2px', marginLeft: 4 }} />
              </a>
              <div className="portal-panel__links">
                <a href="https://ecampus.rugipo.edu.ng/putme" target="_blank" rel="noopener noreferrer">
                  <span className="portal-panel__badge"><Sparkles size={16} /></span>
                  <span><strong>New Students</strong><small>PUTME screening &amp; fresh registration · ecampus.rugipo.edu.ng/putme</small></span>
                </a>
                <a href="https://ecampus.rugipo.edu.ng/portal" target="_blank" rel="noopener noreferrer">
                  <span className="portal-panel__badge"><GraduationCap size={16} /></span>
                  <span><strong>Returning Students</strong><small>Log in to your student portal · ecampus.rugipo.edu.ng/portal</small></span>
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------- ICT services band ------------------- */}
      <section className="section container" style={{ paddingTop: 0 }}>
        <Reveal>
          <div className="services-band">
            <div className="services-band__main">
              <div className="services-band__ic"><Monitor size={22} /></div>
              <div>
                <strong>ICT Services We Support</strong>
                <p>From portal access to payments, results and more — one place to report anything that is not working, and a real team that follows it through.</p>
                <Link to="/new-ticket" className="btn btn--outline btn--light" style={{ marginTop: 8 }}>Log a complaint about any of them →</Link>
              </div>
            </div>
            <ul className="services-band__list">
              {(categories.length ? categories.slice(0, 10).map((c) => c.name) : ['Student Portal', 'Payments', 'Course Registration', 'Results', 'Email', 'CBT']).map((n) => (
                <li key={n}><Check size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{n}</li>
              ))}
            </ul>
          </div>
        </Reveal>
      </section>

      {/* ----------------------------- reassurance strip ----------------------------- */}
      <section className="section container" style={{ paddingTop: 0 }}>
        <Reveal>
          <div className="trust-strip">
            <div>
              <span className="trust-strip__ic"><GraduationCap size={20} /></span>
              <strong>Your details stay yours</strong>
              <p>We only use your information to handle your complaint and update you — nothing else.</p>
            </div>
            <div>
              <span className="trust-strip__ic"><Timer size={20} /></span>
              <strong>Nothing gets lost</strong>
              <p>Every complaint is numbered and tracked from the day it arrives until the day it is solved.</p>
            </div>
            <div>
              <span className="trust-strip__ic"><Mail size={20} /></span>
              <strong>You will hear from us</strong>
              <p>Emails go out when we receive it, when we reply, and the moment it is solved — no chasing us.</p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ------------- recent updates — last thing before the footer ------------- */}
      {updates.length > 0 && (
        <section id="updates" className="section container" style={{ paddingTop: 0 }}>
          <Reveal>
            <div className="updates-panel">
              <div className="updates-panel__head">
                <div>
                  <h2 className="section__title" style={{ margin: 0 }}>Recent Updates</h2>
                  <p className="section__sub" style={{ margin: 0 }}>Straight from the ICT Support Unit — the latest first.</p>
                </div>
                {updates.length > 2 && (
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => setShowAllUpdates((s) => !s)}>
                    {showAllUpdates ? 'Show fewer' : `Show all ${updates.length} updates`}
                  </button>
                )}
              </div>
              <div className="updates-panel__list">
                {(showAllUpdates ? updates : updates.slice(0, 2)).map((a, i) => (
                  <Reveal key={a.id} delay={i * 70}>
                    <article className={`card update-card update-card--${a.kind}`}>
                      <div className="update-card__head">
                        <span className={`badge badge--news-${a.kind}`}>{a.kind}</span>
                        <time>{new Date(a.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
                      </div>
                      <strong>{a.title}</strong>
                      <p className="muted" style={{ fontSize: '.9rem', margin: '6px 0 0' }}>{a.body}</p>
                    </article>
                  </Reveal>
                ))}
              </div>
            </div>
          </Reveal>
        </section>
      )}
    </>
  );
}
