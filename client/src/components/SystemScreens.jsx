import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Home, Mail, Phone, RefreshCw, Wrench } from 'lucide-react';
import { api } from '../auth.jsx';

/**
 * The official ICT contact details come from the server's own configuration —
 * never invented here. Fallbacks match the homepage.
 */
export function useIctContact() {
  const [contact, setContact] = React.useState(null);
  React.useEffect(() => {
    api('/meta').then((d) => {
      if (d?.contact) setContact(d.contact);
    }).catch(() => { /* the screen itself already explains how to reach ICT */ });
  }, []);
  return contact;
}

export function ContactBlock() {
  const contact = useIctContact();
  const email = contact?.email || 'ecampus@rugipo.edu.ng';
  const phone = contact?.phone || '';
  return (
    <div className="sys-contact">
      <strong>Need immediate assistance?</strong>
      <p>Contact the RUGIPO ICT Directorate.</p>
      <div className="sys-contact__row">
        <a className="btn btn--outline btn--sm" href={`mailto:${email}`}><Mail size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />{email}</a>
        {phone && <a className="btn btn--outline btn--sm" href={`tel:${phone.replace(/\s+/g, '')}`}><Phone size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />{phone}</a>}
        <a className="btn btn--outline btn--sm" href="/contact">Contact ICT Support</a>
      </div>
    </div>
  );
}

function Screen({ title, lead, children, note }) {
  return (
    <section className="section container" style={{ maxWidth: 620, minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
      <div className="card sys-screen" style={{ textAlign: 'center', padding: '36px 28px', width: '100%' }}>
        <img src="/rugipo-logo.png" alt="Rufus Giwa Polytechnic, Owo" style={{ width: 64, height: 64, objectFit: 'contain', margin: '0 auto 14px' }} />
        <h1 className="section__title" style={{ marginTop: 0 }}>{title}</h1>
        <p className="section__sub" style={{ marginBottom: 6 }}>{lead}</p>
        {children}
        {note && <p className="muted" style={{ fontSize: '.8rem', marginTop: 18 }}>{note}</p>}
        <p className="muted" style={{ fontSize: '.78rem', marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          Rufus Giwa Polytechnic, Owo — ICT Directorate
        </p>
      </div>
    </section>
  );
}

/**
 * DESIGN 1 — a service that is not available (never launched, disabled,
 * future integration). Deliberately calm and institutional.
 */
export function UnavailableFeature({ title = 'Oops! This Service Isn\u2019t Available Yet', message }) {
  const nav = useNavigate();
  return (
    <Screen
      title={title}
      lead={message || 'The service you are trying to access is currently unavailable.'}
      note="Please contact the RUGIPO ICT Directorate if you need assistance or believe this service should be available."
    >
      <div className="sys-actions">
        <button type="button" className="btn btn--navy" onClick={() => nav(-1)}><ArrowLeft size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Go Back</button>
        <button type="button" className="btn btn--outline" onClick={() => nav('/')}><Home size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Return to Home</button>
      </div>
      <ContactBlock />
    </Screen>
  );
}

/**
 * DESIGN 2 — the system hit an unexpected problem while doing something the
 * student asked for. Nothing they typed is lost; they can retry.
 */
export function SystemError({ title = 'We\u2019re Having Trouble Connecting', message, onRetry, retryLabel = 'Try Again' }) {
  const nav = useNavigate();
  return (
    <Screen
      title={title}
      lead={message || 'Something went wrong while connecting to the RUGIPO ICT Support System. Your information has not been intentionally discarded.'}
    >
      <div className="sys-actions">
        {onRetry && <button type="button" className="btn btn--navy" onClick={onRetry}><RefreshCw size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />{retryLabel}</button>}
        <button type="button" className="btn btn--outline" onClick={() => nav('/')}>Return to Home</button>
      </div>
      <p className="muted" style={{ fontSize: '.88rem', marginTop: 16 }}>If the problem continues:</p>
      <ContactBlock />
    </Screen>
  );
}

/**
 * Server-controlled maintenance window. The frontend only shows it when the
 * server says so (api meta flag) — it is never hardcoded on.
 */
export function MaintenanceMode() {
  const nav = useNavigate();
  return (
    <Screen
      title="RUGIPO ICT Support System Temporarily Unavailable"
      lead="The ICT Support Ticketing System is currently undergoing maintenance. Please try again shortly."
    >
      <div className="sys-actions">
        <button type="button" className="btn btn--navy" onClick={() => window.location.reload()}><Wrench size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Try Again</button>
      </div>
      <p className="muted" style={{ fontSize: '.88rem', marginTop: 16 }}>For urgent ICT issues:</p>
      <ContactBlock />
    </Screen>
  );
}

/** Branded 404 — a genuinely wrong address, distinct from an unavailable service. */
export function NotFound() {
  const nav = useNavigate();
  return (
    <Screen
      title="Page Not Found"
      lead="The page you are looking for does not exist or may have moved."
    >
      <div className="sys-actions">
        <button type="button" className="btn btn--navy" onClick={() => nav('/')}>Return to RUGIPO ICT Support</button>
        <button type="button" className="btn btn--outline" onClick={() => nav(-1)}>Go Back</button>
      </div>
    </Screen>
  );
}

/**
 * Layer 3 — application crash. Rendered by the global error boundary in
 * main.jsx: a crashed page must NEVER become a blank white screen.
 */
export class CrashScreen extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) {
    // Technical detail stays in the developer's console only — the screen
    // itself never shows it (§39).
    console.error('[crash boundary]', err);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const reset = () => {
      this.setState({ failed: false });
      if (this.props.onReset) this.props.onReset();
    };
    return (
      <Screen
        title="Please Visit ICT Support"
        lead="We encountered an unexpected problem while loading this page. Please try again."
        note="If the problem continues, please visit the ICT Directorate immediately or contact ICT Support."
      >
        <div className="sys-actions">
          <button type="button" className="btn btn--navy" onClick={reset}><RefreshCw size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Try Again</button>
          <a className="btn btn--outline" href="/">Go to Home</a>
        </div>
        <ContactBlock />
      </Screen>
    );
  }
}
