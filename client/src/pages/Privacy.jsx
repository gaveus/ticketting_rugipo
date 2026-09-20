import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Privacy / data-protection notice (NDPR-aligned).
 * Plain-language summary of exactly what the system stores and why —
 * the school's data-protection officer will ask for this eventually.
 */
export default function Privacy() {
  return (
    <section className="section container" style={{ maxWidth: 780 }}>
      <span className="hero__badge">Privacy &amp; your data</span>
      <h1 className="section__title" style={{ margin: '10px 0 4px', fontSize: '1.7rem' }}>
        What we do with your information
      </h1>
      <p className="section__sub" style={{ marginBottom: 24 }}>
        Short version: we only collect what we need to solve your complaint, we only share it with
        the ICT staff handling your case, and closed conversations are permanently deleted.
      </p>

      <div className="card mb">
        <strong>What we collect, and why</strong>
        <ul className="muted" style={{ margin: '10px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
          <li><strong>Your name, matric/registration number, faculty and department</strong> — so we know whose account or record we are fixing, and so returning students get their details remembered.</li>
          <li><strong>Email address and phone number</strong> — to send you updates and reach you if an officer needs more detail.</li>
          <li><strong>What you tell us about the problem</strong>, including any payment details and the receipt or screenshots you attach — these are the evidence ICT uses to verify your case. Payment details go only to the Payment desk officers.</li>
          <li><strong>A record of each step</strong> (who replied, when the status changed) — this protects you: there is always a trail of what ICT did and when.</li>
        </ul>
      </div>

      <div className="card mb">
        <strong>Who can see it</strong>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Only signed-in ICT staff. First-line ICT Support and the Senior Engineers on the desk that
          owns your complaint can see your case details. Internal notes between officers are never
          shown to students, and your evidence is never used for anything outside your complaint.
        </p>
      </div>

      <div className="card mb">
        <strong>How long we keep it</strong>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Live chat conversations exist only while they are open — when either side closes a
          conversation, the <strong>entire message history is permanently deleted</strong> from our
          database. Complaint tickets and their audit trail are kept so the Directorate can account
          for every case it has handled. You can ask us to remove your personal details at any time
          using the contact details below.
        </p>
      </div>

      <div className="card mb">
        <strong>Your rights</strong>
        <ul className="muted" style={{ margin: '10px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Ask what data we hold about you, and get a copy.</li>
          <li>Ask us to correct anything wrong — or simply log a complaint and we will fix the source.</li>
          <li>Ask us to delete your personal details.</li>
          <li>Unsubscribe from ICT email updates at any time (every email includes how).</li>
        </ul>
      </div>

      <div className="notice notice--info">
        <strong>Questions about your data?</strong> Email{' '}
        <a href="mailto:ecampus@rugipo.edu.ng">ecampus@rugipo.edu.ng</a> or call ☎ +234803******* —
        Rufus Giwa Polytechnic, Owo ICT Directorate.
      </div>

      <p className="muted mt" style={{ fontSize: '.85rem' }}>
        See also our <Link to="/">homepage</Link>, <Link to="/new-ticket">log a complaint</Link> and{' '}
        <Link to="/track">track a complaint</Link> pages.
      </p>
    </section>
  );
}
