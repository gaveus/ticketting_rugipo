import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiUpload } from '../auth.jsx';
import { ArrowRight, ArrowLeft, CheckCircle2, ClipboardList, GraduationCap } from 'lucide-react';

const STEPS = ['Your details', 'What do you need help with?', 'The exact problem', 'Tell us more', 'Review', 'Done'];

const EMPTY = {
  studentName: '', matricNo: '', regNo: '', phone: '', email: '', facultyId: '', departmentId: '',
  academicLevel: '', studyMode: '',
};
/** Honeypot: bots fill every input; humans never see this field. */
const HONEY = { website: '' };

export default function NewTicket() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [meta, setMeta] = useState({ categories: [], issues: [], faculties: [], levels: [], modes: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const topRef = useRef(null);

  const [details, setDetails] = useState(EMPTY);
  const [categoryId, setCategoryId] = useState(null);
  const [issueId, setIssueId] = useState(null);
  const [description, setDescription] = useState('');
  const [payment, setPayment] = useState({
    amount: '', paidFor: '', paymentMethod: '', paymentDate: '', portalStatus: '', whatHappened: '',
  });
  const [other, setOther] = useState({ tried: '', happened: '', expected: '', errorText: '' });
  const [files, setFiles] = useState([]);
  const [subscribe, setSubscribe] = useState(true);
  const [honey, setHoney] = useState(HONEY);
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    api('/meta').then(setMeta).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { topRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [step]);

  // Returning-student memory: once matric + email are both filled, look the
  // student up and offer to reuse their details.
  const [recognized, setRecognized] = useState(null); // student object | 'not-found' | null
  const [recognizing, setRecognizing] = useState(false);
  useEffect(() => {
    const m = details.matricNo.trim(), e = details.email.trim();
    if (m.length < 4 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setRecognized(null); return; }
    const t = setTimeout(async () => {
      setRecognizing(true);
      try {
        const d = await api('/students/recognize', { method: 'POST', body: JSON.stringify({ matricNo: m, email: e }) });
        setRecognized(d.known ? d.student : 'not-found');
      } catch { setRecognized(null); }
      finally { setRecognizing(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [details.matricNo, details.email]);

  function applyRecognized() {
    if (!recognized || recognized === 'not-found') return;
    setDetails((d) => ({
      ...d,
      studentName: recognized.fullName || d.studentName,
      regNo: recognized.regNo || d.regNo,
      facultyId: recognized.facultyId ? String(recognized.facultyId) : d.facultyId,
      departmentId: recognized.departmentId ? String(recognized.departmentId) : d.departmentId,
      academicLevel: recognized.academicLevel || d.academicLevel,
      studyMode: recognized.studyMode || d.studyMode,
    }));
  }

  const category = meta.categories.find((c) => c.id === Number(categoryId));
  const issue = meta.issues.find((i) => i.id === Number(issueId));
  const isPaymentIssue = !!issue?.requiresPaymentDetails;
  const isOtherIssue = category?.name === 'Other';
  const faculty = meta.faculties.find((f) => f.id === Number(details.facultyId));
  const departments = faculty ? faculty.departments : [];
  const levelLabel = meta.levels.find((l) => l.value === details.academicLevel)?.label || '';
  const modeLabel = meta.modes.find((m) => m.value === details.studyMode)?.label || '';

  // Guided questions for the chosen service (database-backed, spec §12/§13).
  const guidedFields = category?.guidedFields || [];
  const [guided, setGuided] = useState({});
  useEffect(() => { setGuided({}); }, [categoryId]);

  function validateStep() {
    if (step === 0) {
      const req = ['studentName', 'matricNo', 'regNo', 'phone', 'email', 'facultyId', 'departmentId', 'academicLevel', 'studyMode'];
      const missing = req.filter((k) => !String(details[k] || '').trim());
      if (missing.length) return 'Please complete every field — ICT needs these details to identify and reach you.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) return 'Enter a valid email — your tracking updates will be sent there.';
      return null;
    }
    if (step === 1) return categoryId ? null : 'Choose what you need help with.';
    if (step === 2) return issueId ? null : 'Choose the exact problem.';
    if (step === 3) {
      if (description.trim().length < 10) return 'Please describe the problem in at least 10 characters.';
      if (isPaymentIssue) {
        const missing = ['amount', 'paidFor', 'paymentMethod', 'paymentDate']
          .filter((k) => !String(payment[k] || '').trim());
        if (missing.length) return 'Please complete the payment details — amount, what the payment was for, how and when you paid.';
      }
      return null;
    }
    return null;
  }

  function next() {
    const v = validateStep();
    if (v) { setError(v); return; }
    // A payment complaint without the receipt cannot go further — the payment
    // desk verifies every claim against the proof of the debit.
    if (isPaymentIssue && step === 3 && files.length === 0) {
      setError('A payment receipt or debit evidence is required — attach a screenshot or PDF of the payment before continuing.');
      topRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setError('');
    setStep((s) => s + 1);
  }
  function back() { setError(''); setStep((s) => Math.max(0, s - 1)); }

  async function submit() {
    setBusy(true); setError('');
    try {
      const payload = {
        ...details,
        categoryId, issueTypeId: issueId, description, subscribe, urgent,
        website: honey.website,
        details: JSON.stringify({ ...(guidedDetailsPayload() || {}),
          ...(isPaymentIssue ? payment : {}),
          ...(isOtherIssue ? other : {}) }),
      };
      // One multipart request carries the complaint AND its files together, so
      // the server can enforce "payment complaints need their receipt" at the
      // moment of creation (the old two-step flow could never satisfy it).
      const fd = new FormData();
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined && v !== null) fd.append(k, String(v));
      }
      for (const f of files) fd.append('files', f);
      const created = await apiUpload('/tickets', fd);
      setResult(created);
      setStep(5);
    } catch (e) {
      // §7 — never pretend success: the panel below states the truth and
      // offers a retry. Nothing was created (the server is the only source
      // of tracking IDs), so the student simply tries again.
      setSubmitError(e.message);
      try { topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* older browsers */ }
    } finally { setBusy(false); }
  }

  /** Merge guided-question answers (category-driven) into the details payload. */
  function guidedDetailsPayload() {
    if (!guidedFields.length) return null;
    const out = {};
    for (const f of guidedFields) if (String(guided[f.name] || '').trim()) out[f.name] = guided[f.name];
    return Object.keys(out).length ? out : null;
  }

  return (
    <section className="section container" ref={topRef} style={{ maxWidth: 800 }}>
      <div className="nt-hero mb">
        <span className="hero__badge">No account needed</span>
        <h1 className="section__title" style={{ margin: '10px 0 4px', fontSize: '1.7rem' }}>Log a complaint</h1>
        <p className="section__sub" style={{ marginBottom: 0 }}>
          Tell us what went wrong — an ICT officer picks it up, and you get email updates at every step, including the moment it is solved.
        </p>
      </div>

      <div className="steps">
        {STEPS.map((label, i) => (
          <div key={label} className={`step ${i < step ? 'is-done' : ''} ${i === step ? 'is-active' : ''}`}>
            {i + 1}. {label}
          </div>
        ))}
      </div>

      {error && <div className="notice notice--err">{error}</div>}

      {/* Honeypot — visually hidden; bots that fill it are rejected. */}
      <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }} aria-hidden="true">
        <label>Leave this field empty<input tabIndex={-1} autoComplete="off" value={honey.website}
          onChange={(e) => setHoney({ ...honey, website: e.target.value })} /></label>
      </div>

      <div className="card">
        {/* ------------------------- Step 1 ------------------------- */}
        {step === 0 && (
          <>
            <h2 className="section__title">Your details</h2>
            <p className="section__sub">No forms of sign-up, no passwords — just tell us who you are and where we can reach you. It takes less than a minute.</p>
            <div className="form-grid">
              <label className="field"><span>Full name</span>
                <input value={details.studentName} onChange={(e) => setDetails({ ...details, studentName: e.target.value })} />
              </label>
              <label className="field"><span>Matriculation number</span>
                <input value={details.matricNo} onChange={(e) => setDetails({ ...details, matricNo: e.target.value })} />
              </label>
              <label className="field"><span>Registration number <small>(as used on the school portal)</small></span>
                <input value={details.regNo} onChange={(e) => setDetails({ ...details, regNo: e.target.value })} />
              </label>
              <label className="field"><span>Phone number</span>
                <input value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} placeholder="080..." />
              </label>
              <label className="field"><span>Email address <small>(updates will be sent here)</small></span>
                <input type="email" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} placeholder="you@example.com" />
              </label>
              {recognized && recognized !== 'not-found' && (
                <div className="notice notice--ok" style={{ gridColumn: '1 / -1' }}>
                  <strong>Welcome back, {recognized.fullName.split(/\s+/)[0]}! <GraduationCap size={15} style={{ verticalAlign: '-2px' }} /></strong> — we remember your details from your last complaint.{' '}
                  <button type="button" className="btn btn--outline btn--sm" style={{ marginLeft: 6 }} onClick={applyRecognized}>Use my saved details</button>
                </div>
              )}
              <label className="field"><span>Faculty / School</span>
                <select value={details.facultyId}
                  onChange={(e) => setDetails({ ...details, facultyId: e.target.value, departmentId: '' })}>
                  <option value="">Select faculty…</option>
                  {meta.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Department <small>(depends on faculty)</small></span>
                <select value={details.departmentId} disabled={!faculty}
                  onChange={(e) => setDetails({ ...details, departmentId: e.target.value })}>
                  <option value="">{faculty ? 'Select department…' : 'Select a faculty first…'}</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}{d.kind !== 'academic' ? ` (${d.kind === 'unit' ? 'Unit' : 'Center'})` : ''}</option>)}
                </select>
              </label>
              <label className="field"><span>Study mode</span>
                <select value={details.studyMode} onChange={(e) => setDetails({ ...details, studyMode: e.target.value })}>
                  <option value="">Select study mode…</option>
                  {meta.modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
              <label className="field"><span>Level</span>
                <select value={details.academicLevel} onChange={(e) => setDetails({ ...details, academicLevel: e.target.value })}>
                  <option value="">Select level…</option>
                  {meta.levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </label>
            </div>
          </>
        )}

        {/* ------------------------- Step 2 ------------------------- */}
        {step === 1 && (
          <>
            <h2 className="section__title">What do you need help with?</h2>
            <p className="section__sub">Pick the closest match. Not sure? Choose the one that sounds most like your situation.</p>
            <div className="chips">
              {meta.categories.map((c) => (
                <button key={c.id} type="button" className="chip"
                  style={Number(categoryId) === c.id ? { borderColor: 'var(--green)', background: '#fdf3c9' } : null}
                  onClick={() => { setCategoryId(c.id); setIssueId(null); }}>
                  <strong>{c.name}</strong>
                  <small>{c.description}</small>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ------------------------- Step 3 ------------------------- */}
        {step === 2 && (
          <>
            <h2 className="section__title">Select the exact problem</h2>
            <p className="section__sub">Within “{category?.name}”.</p>
            <div className="chips">
              {meta.issues.filter((i) => i.categoryId === Number(categoryId)).map((i) => (
                <button key={i.id} type="button" className="chip"
                  style={Number(issueId) === i.id ? { borderColor: 'var(--green)', background: '#fdf3c9' } : null}
                  onClick={() => setIssueId(i.id)}>
                  <strong>{i.name}</strong>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ------------------------- Step 4 ------------------------- */}
        {step === 3 && (
          <>
            <h2 className="section__title">Tell us more</h2>
            <p className="section__sub">This is where you tell us exactly what went wrong. The more you share, the faster we fix it.</p>

            <label className="field"><span>What happened? Describe the problem.</span>
              <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. I paid for my school fees since Monday but the portal still says unpaid…" />
            </label>

            {isPaymentIssue && (
              <>
                <div className="notice notice--info">
                  You selected a <strong>payment issue</strong>. Fill in the payment details below and
                  upload your payment receipt — <strong>the receipt is compulsory</strong>; it is the proof
                  of the debit that the Payment desk verifies against official records.
                </div>
                <div className="form-grid">
                  <label className="field"><span>What was the payment meant for? <em>*</em></span>
                    <input value={payment.paidFor} onChange={(e) => setPayment({ ...payment, paidFor: e.target.value })}
                      placeholder="e.g. School fees, departmental dues, acceptance fee" />
                  </label>
                  <label className="field"><span>How much did you pay? <em>*</em></span>
                    <input value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
                      placeholder="e.g. 45,500" />
                  </label>
                  <label className="field"><span>How did you pay? <em>*</em></span>
                    <select value={payment.paymentMethod} onChange={(e) => setPayment({ ...payment, paymentMethod: e.target.value })}>
                      <option value="">Select how you paid…</option>
                      <option>Transfer</option>
                      <option>Bank branch</option>
                      <option>POS</option>
                      <option>Other</option>
                    </select>
                  </label>
                  <label className="field"><span>When did you pay? <em>*</em></span>
                    <input value={payment.paymentDate} onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })}
                      placeholder="e.g. 12 March 2026, around 2 pm" />
                  </label>
                  <label className="field"><span>What does the portal show now?</span>
                    <input value={payment.portalStatus} onChange={(e) => setPayment({ ...payment, portalStatus: e.target.value })} placeholder="e.g. Still shows unpaid" />
                  </label>
                  <label className="field"><span>What happened right after payment?</span>
                    <input value={payment.whatHappened} onChange={(e) => setPayment({ ...payment, whatHappened: e.target.value })} placeholder="e.g. nothing changed, page refreshed" />
                  </label>
                </div>
              </>
            )}

            {isOtherIssue && (
              <div className="form-grid">
                <label className="field"><span>What were you trying to do?</span>
                  <textarea rows={2} value={other.tried} onChange={(e) => setOther({ ...other, tried: e.target.value })} />
                </label>
                <label className="field"><span>What happened instead?</span>
                  <textarea rows={2} value={other.happened} onChange={(e) => setOther({ ...other, happened: e.target.value })} />
                </label>
                <label className="field"><span>What did you expect to happen?</span>
                  <textarea rows={2} value={other.expected} onChange={(e) => setOther({ ...other, expected: e.target.value })} />
                </label>
                <label className="field"><span>What error message did you see, if any?</span>
                  <input value={other.errorText} onChange={(e) => setOther({ ...other, errorText: e.target.value })} placeholder="Leave blank if none" />
                </label>
              </div>
            )}

            {guidedFields.length > 0 && !isPaymentIssue && !isOtherIssue && (
              <div className="form-grid">
                {guidedFields.map((f) => (
                  <label className="field" key={f.name}><span>{f.label}</span>
                    {f.type === 'textarea' ? (
                      <textarea rows={2} value={guided[f.name] || ''}
                        onChange={(e) => setGuided({ ...guided, [f.name]: e.target.value })} />
                    ) : f.type === 'select' ? (
                      <select value={guided[f.name] || ''}
                        onChange={(e) => setGuided({ ...guided, [f.name]: e.target.value })}>
                        <option value="">Select…</option>
                        {(f.options || []).map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input value={guided[f.name] || ''} placeholder={f.placeholder || ''}
                        onChange={(e) => setGuided({ ...guided, [f.name]: e.target.value })} />
                    )}
                  </label>
                ))}
              </div>
            )}

            <label className="field"><span>
              {isPaymentIssue
                ? <>Payment receipt / debit evidence <em>*</em> <small>(required for payment complaints — PNG, JPG, WEBP, GIF or PDF, max 5&nbsp;MB each)</small></>
                : <>Attach screenshots or evidence <small>(optional — PNG, JPG, WEBP, GIF or PDF, max 5&nbsp;MB each)</small></>}
            </span>
              <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf"
                onChange={(e) => setFiles([...e.target.files].slice(0, 5))} />
            </label>
            {files.length > 0 && <p className="muted" style={{ fontSize: '.85rem' }}>{files.length} file(s) ready.</p>}
            {isPaymentIssue && files.length === 0 && (
              <p className="notice notice--err" style={{ padding: '8px 12px' }}>
                No receipt attached yet — payment complaints cannot be submitted without the payment evidence.
              </p>
            )}

            <label className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 3 }} />
              <span style={{ fontWeight: 400, fontSize: '.9rem' }}>
                <strong>This is urgent</strong> — a deadline (like course registration closing) makes this
                time-sensitive. Urgent complaints are sorted to the top of the queue.
              </span>
            </label>

            <label className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={subscribe} onChange={(e) => setSubscribe(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 3 }} />
              <span style={{ fontWeight: 400, fontSize: '.9rem' }}>
                Keep me updated by email about this complaint (and important ICT notices). You can unsubscribe any time.
              </span>
            </label>
          </>
        )}

        {/* ------------------------- Step 5 ------------------------- */}
        {step === 4 && (
          <>
            <h2 className="section__title">Review your complaint</h2>
            <div className="notice notice--info">
              Category: <strong>{category?.name}</strong> · Issue: <strong>{issue?.name}</strong>
            </div>
            <p><strong>From:</strong> {details.studentName} ({details.matricNo})</p>
            <p><strong>Academic details:</strong> {faculty?.name} → {departments.find((d) => String(d.id) === String(details.departmentId))?.name} · {levelLabel} {modeLabel}</p>
            <p><strong>Contact:</strong> {details.email} · {details.phone}</p>
            <p><strong>Describe:</strong></p>
            <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{description}</p>
            {isPaymentIssue && (
              <>
                <p><strong>Payment details:</strong></p>
                <ul className="muted">
                  <li>Payment was for: {payment.paidFor || '—'}</li>
                  <li>Amount: {payment.amount || '—'} · Method: {payment.paymentMethod || '—'} · Date: {payment.paymentDate || '—'}</li>
                  <li>Portal shows: {payment.portalStatus || '—'} · After payment: {payment.whatHappened || '—'}</li>
                  <li>Proof: {files.length ? files.map((f) => f.name).join(', ') : 'none attached'}</li>
                </ul>
              </>
            )}
            {files.length > 0 && <p><strong>Attachments:</strong> {files.map((f) => f.name).join(', ')}</p>}
          </>
        )}

        {/* ------------------------- Step 6 ------------------------- */}
        {step === 5 && result && (
          <>
            <h2 className="section__title"><CheckCircle2 size={20} style={{ verticalAlign: '-4px', marginRight: 7 }} />Complaint submitted</h2>
            <div className="nt-success">
              <small>Your Tracking ID — write it down and keep it safe</small>
              <div className="nt-success__id">{result.ticketNumber}</div>
              <button type="button" className="btn btn--outline btn--sm"
                onClick={() => { try { navigator.clipboard.writeText(result.ticketNumber); } catch { /* clipboard blocked */ } }}>
                <ClipboardList size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />Copy ID
              </button>
              <p className="muted" style={{ margin: '10px 0 0' }}>
                We've also sent a confirmation to <strong>{result.email}</strong>.
              </p>
            </div>
            <p><strong>What happens next:</strong></p>
            <ol className="muted">
              <li>ICT staff review your complaint and pick it up.</li>
              <li>You'll get an email at every important step — including when it's <strong>solved</strong>.</li>
              <li>Check progress any time with <strong>Track Ticket</strong> using this ID and your email.</li>
            </ol>
            <div className="row">
              <button className="btn btn--navy" onClick={() => nav('/track')}>Track this ticket</button>
              <button className="btn btn--outline" onClick={() => {
                // Keep the student's details — they're already known. Only the
                // complaint itself resets, so logging another one is one click.
                setStep(0); setCategoryId(null); setIssueId(null); setDescription('');
                setPayment({ amount: '', paidFor: '', paymentMethod: '', paymentDate: '', portalStatus: '', whatHappened: '' });
                setOther({ tried: '', happened: '', expected: '', errorText: '' });
                setGuided({}); setFiles([]); setResult(null);
              }}>
                Log another complaint
              </button>
            </div>
          </>
        )}

        {/* ------------------ submission failure (§7) ------------------ */}
        {step === 4 && submitError && (
          <div className="card mt" style={{ borderLeft: '4px solid #b3261e', textAlign: 'center', padding: '22px 18px' }}>
            <img src="/rugipo-logo.png" alt="" style={{ width: 46, height: 46, objectFit: 'contain', margin: '0 auto 8px', display: 'block' }} />
            <h3 className="panel-title" style={{ justifyContent: 'center' }}>We Couldn't Submit Your Ticket</h3>
            <p className="muted" style={{ fontSize: '.9rem' }}>
              Your ticket could not be submitted at this time. {submitError}
            </p>
            <p className="muted" style={{ fontSize: '.84rem' }}>
              Please check your internet connection and try again. If the problem continues, contact ICT Support —
              your details below are still filled in, nothing was lost.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn--navy" disabled={busy} onClick={submit}>
                {busy ? 'Submitting…' : 'Try Again'}
              </button>
              <a className="btn btn--outline" href="/contact">Contact ICT Support</a>
            </div>
          </div>
        )}

        {/* ---------------------- nav buttons ---------------------- */}
        {step < 5 && (
          <div className="row mt" style={{ justifyContent: 'space-between' }}>
            <button className="btn btn--outline" onClick={back} disabled={step === 0 || busy}><ArrowLeft size={15} style={{ verticalAlign: '-2px', marginRight: 4 }} />Back</button>
            {step < 4
              ? <button className="btn btn--navy" onClick={next}>Continue <ArrowRight size={15} style={{ verticalAlign: '-2px', marginLeft: 4 }} /></button>
              : <button className="btn btn--primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit complaint'}</button>}
          </div>
        )}
      </div>
    </section>
  );
}
