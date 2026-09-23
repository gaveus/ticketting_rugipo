import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveChat } from '../hooks/useLiveChat';
import { Link2, ArrowRight } from 'lucide-react';

/**
 * Live chat for a student's question — no account needed, instant over
 * websocket (Messenger-style: typing, opened, delivered). The link (with its
 * secret token) was emailed to the student; whoever holds the link is the
 * student. Closing the conversation deletes the whole history on both sides.
 */
export default function Chat() {
  const { token } = useParams();
  const { thread, live, send, sendTyping, close } = useLiveChat({ mode: 'student', token });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread?.messages?.length, thread?.staffTyping]);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await send(text); setText(''); setError(''); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function doClose() {
    setBusy(true);
    try { await close(); setConfirmClose(false); } finally { setBusy(false); }
  }

  if (!thread && !error) {
    return (
      <section className="section container" style={{ maxWidth: 760 }}>
        <div className="chat-card">
          <div className="page-loading" role="status">
            <span className="page-loading__spinner" aria-hidden="true" />
            <strong>Please hold on while we open the conversation…</strong>
          </div>
        </div>
      </section>
    );
  }

  if (error && !thread) {
    return (
      <section className="section container" style={{ maxWidth: 620 }}>
        <div className="card" style={{ textAlign: 'center', padding: '38px 26px' }}>
          <div style={{ fontSize: '2.4rem' }}><Link2 size={30} /></div>
          <h2 style={{ margin: '10px 0 6px' }}>This link is not valid</h2>
          <p className="muted">The conversation link may be old or mistyped. Check the email we sent you, or start fresh below.</p>
          <Link to="/contact" className="btn btn--navy mt">Message ICT again <ArrowRight size={15} style={{ verticalAlign: '-2px' }} /></Link>
        </div>
      </section>
    );
  }

  return (
    <section className="section container" style={{ maxWidth: 760 }}>
      <div className="chat-card">
        <header className="chat-card__head">
          <div className="chat-card__id">
            <img src="/rugipo-logo.png" alt="" style={{ width: 38, height: 38, borderRadius: '50%', padding: 2, background: '#fff', border: '2px solid var(--gold)' }} />
            <div>
              <strong>ICT Support · Live conversation</strong>
              <small>{thread ? `About: ${thread.subject}` : ''}{live ? ' · connected live' : ''}</small>
            </div>
          </div>
          {thread && !thread.closed && (
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setConfirmClose(true)}>
              End conversation
            </button>
          )}
        </header>

        {thread?.closed ? (
          <div className="chat-card__body chat-closed">
            <h3>Conversation closed</h3>
            <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 14 }}>
              <Link to="/contact" className="btn btn--navy">Message ICT <ArrowRight size={15} style={{ verticalAlign: '-2px' }} /></Link>
              <Link to="/new-ticket" className="btn btn--outline">Log a complaint instead</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="chat-card__body" aria-live="polite">
              {thread && thread.messages.length === 0 && (
                <p className="muted" style={{ textAlign: 'center' }}>No messages yet — say hello below. ICT sees your message the moment you send it.</p>
              )}
              {thread && thread.messages.map((m) => (
                <div key={m.id} className={`chat-msg ${m.sender === 'student' ? 'chat-msg--me' : ''}`}>
                  <div className="chat-msg__bubble">
                    <span className="chat-msg__who">{m.sender === 'student' ? 'You' : (m.sender_name || 'ICT Support')}</span>
                    {m.body}
                    <time>{new Date(m.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                </div>
              ))}
              {thread?.staffTyping && (
                <div className="chat-msg">
                  <div className="chat-msg__bubble typing-bubble" aria-live="polite">
                    <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
                    ICT Support is typing…
                  </div>
                </div>
              )}
              {thread && !thread.closed && !thread.staffTyping && thread.staffSeenAt && (
                <small className="chat-card__presence">ICT Support is here — replies appear instantly, no refreshing needed.</small>
              )}
              <div ref={endRef} />
            </div>

            {error && <div className="notice notice--err">{error}</div>}

            <form className="chat-card__form" onSubmit={submit}>
              <input
                value={text}
                onChange={(e) => { setText(e.target.value); sendTyping(); }}
                placeholder="Type your message…"
                maxLength={4000}
                aria-label="Type your message"
              />
              <button className={`btn btn--navy ${busy ? 'btn--busy' : ''}`} disabled={busy || !text.trim()}>
                {busy ? ' ' : <>Send <ArrowRight size={14} style={{ verticalAlign: '-2px' }} /></>}
              </button>
            </form>
            <p className="muted chat-card__note">
              Keep this link private: it is the key to this conversation. Closing it deletes the whole history for both sides.
            </p>
          </>
        )}
      </div>

      {confirmClose && (
        <div className="modal-backdrop" onClick={() => setConfirmClose(false)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>End this conversation?</h3>
            <p className="muted">
              This will close the conversation with ICT Support. This cannot be undone.
            </p>
            <div className="row" style={{ gap: 10, marginTop: 14 }}>
              <button className="btn btn--navy" onClick={doClose} disabled={busy}>Yes, end it</button>
              <button className="btn btn--outline" onClick={() => setConfirmClose(false)}>Keep chatting</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
