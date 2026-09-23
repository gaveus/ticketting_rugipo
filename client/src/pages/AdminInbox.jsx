import React, { useEffect, useRef, useState } from 'react';
import { api, fmtDateTime } from '../auth.jsx';
import { useLiveChat } from '../hooks/useLiveChat';
import { Search, Inbox, Eye, Mail } from 'lucide-react';

/**
 * Inbox — questions students sent through the "Talk to ICT" page.
 * Each message opens into a LIVE websocket conversation: messages, typing and
 * "student opened the chat" appear instantly (Messenger-style), with the old
 * polling as automatic fallback. Closing a conversation deletes its entire
 * history — only then, for both sides.
 */
export default function AdminInbox() {
  const [list, setList] = useState(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [showAnswered, setShowAnswered] = useState(true);
  // Search + filter so a thousand-student inbox stays usable.
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | waiting | answered | closed
  const [visibleCount, setVisibleCount] = useState(12);

  // Reset the page back to the top whenever a search or filter changes.
  function load(q = query, filter = statusFilter) {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (filter !== 'all') params.set('filter', filter);
    const qs = params.toString();
    api(`/staff/inbox${qs ? `?${qs}` : ''}`).then((d) => { setList(d.messages); setUnread(d.unread); setOpenId(null); }).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Search as you type (debounced), instantly filtered server-side.
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
  }, [query, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  // The list refreshes on a quiet timer (the thread itself is websocket-live).
  useEffect(() => { const t = setInterval(() => load(), 15000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (list || []).slice(0, visibleCount);

  return (
    <>
      <div className="panel-head">
        <div>
          <h2 className="section__title" style={{ margin: 0 }}>Student questions</h2>
          <p className="panel-sub">
            {list ? `${unread} waiting for you · ${list.filter((m) => m.closed_at).length} closed · showing ${shown.length} of ${list.length}` : 'Loading…'}
            {' '}— live now: you see when a student opens the chat and when they are typing, instantly.
          </p>
        </div>
        <div className="inbox-toolbar">
          <div className="inbox-search">
            <span aria-hidden="true"><Search size={15} /></span>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisibleCount(12); }}
              placeholder="Search name, email, matric no, phone, subject…"
              aria-label="Search student questions"
            />
            {query && <button type="button" className="inbox-search__clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </div>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setVisibleCount(12); }} aria-label="Filter conversations">
            <option value="all">All conversations</option>
            <option value="waiting">Waiting for a reply</option>
            <option value="answered">Answered</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {error && <div className="notice notice--err">{error}</div>}

      {!list && (
        <div className="page-loading" role="status">
          <span className="page-loading__spinner" aria-hidden="true" />
          <strong>Please hold on while we fetch your messages…</strong>
          <small>Opening the inbox of student questions.</small>
        </div>
      )}

      {list && shown.length === 0 && (
        <div className="card empty-state">
          <div style={{ fontSize: '2rem' }}><Inbox size={28} /></div>
          <strong>{query || statusFilter !== 'all' ? 'No conversations match' : 'Nothing waiting'}</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {query || statusFilter !== 'all'
              ? 'Try a different name, matric number or filter.'
              : 'Questions students send from the "Talk to ICT" page land here.'}
          </p>
        </div>
      )}

      <div className="inbox-list">
        {list && shown.map((m) => {
          const isOpen = openId === m.id;
          const waiting = !m.closed_at && (m.status === 'new' || m.last_sender === 'student');
          return (
            <div key={m.id} className={`inbox-row ${isOpen ? 'is-open' : ''} ${waiting && !isOpen ? 'needs-attention' : ''}`}>
              <button type="button" className="inbox-row__main" onClick={() => setOpenId(isOpen ? null : m.id)}>
                <span className="inbox-row__avatar">{m.sender_name?.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <span className="inbox-row__meta">
                  <strong>{m.subject}</strong>
                  <small>{m.sender_name} · {m.email}</small>
                  <small className="inbox-row__preview">
                    {m.closed_at
                      ? '— conversation closed —'
                      : m.last_msg_at
                        ? `${m.last_sender === 'staff' ? 'You: ' : ''}${(m.last_preview || m.message).slice(0, 70)}`
                        : m.message.slice(0, 70)}
                  </small>
                </span>
                <span className="inbox-row__side">
                  {waiting && <span className="badge badge--waiting">Needs reply</span>}
                  {m.closed_at && <span className="badge badge--closed">Closed</span>}
                  {m.student_opened_at && !m.closed_at && (
                    <small title="The student has this conversation open on their side"><Eye size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} />opened chat</small>
                  )}
                  <small>{fmtDateTime(m.last_msg_at || m.created_at)}</small>
                </span>
              </button>

              {isOpen && (m.closed_at
                ? (
                  <div className="inbox-thread">
                    <div className="chat-closed">
                      <strong>Conversation closed</strong>
                    </div>
                  </div>
                )
                : (
                  <LiveThread id={m.id} fallbackMeta={m} onClosed={() => load()} />
                ))}
            </div>
          );
        })}
      </div>
      {list && list.length > visibleCount && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setVisibleCount((n) => n + 12)}>
            Show 12 more ({list.length - visibleCount} remaining)
          </button>
        </div>
      )}

    </>
  );
}

/** The live conversation for one inbox message — websocket via useLiveChat. */
function LiveThread({ id, fallbackMeta, onClosed }) {
  const { thread, live, send, sendTyping, close, setThread } = useLiveChat({ mode: 'staff', messageId: id });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread?.messages?.length, thread?.studentTyping]);

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try { await send(text); setText(''); setErr(''); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function emailReply() {
    const t = thread?.messages?.filter((m) => m.sender === 'staff').slice(-1)[0];
    if (!t) { setErr('Write the reply in the conversation first — it is sent as the email.'); return; }
    setBusy(true);
    try {
      await api(`/staff/inbox/${id}/reply`, { method: 'POST', body: JSON.stringify({ reply: t.body }) });
      setErr('');
      setNote(`A copy of "${t.body.slice(0, 48)}${t.body.length > 48 ? '…' : ''}" was emailed to ${fallbackMeta.email}.`);
      setTimeout(() => setNote(''), 6000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function doClose() {
    setBusy(true);
    try { await close(); setConfirmClose(false); onClosed(); } finally { setBusy(false); }
  }

  return (
    <div className="inbox-thread">
      <div className="inbox-thread__info">
        <strong>{thread?.subject || fallbackMeta.subject}</strong>
        <span>{fallbackMeta.sender_name} · {fallbackMeta.email}{fallbackMeta.matric_no ? ` · ${fallbackMeta.matric_no}` : ''}{fallbackMeta.phone ? ` · ${fallbackMeta.phone}` : ''}</span>
        <small className="inbox-thread__presence">
          {live ? <><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: 'var(--green, #16a34a)', marginRight: 5 }} />Live — updates appear instantly</> : <><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: '#d97706', marginRight: 5 }} />Reconnecting… (still working via updates)</>}
          {thread?.studentLastOpenedAt ? ` · student opened the chat ${fmtDateTime(thread.studentLastOpenedAt)}` : ''}
        </small>
      </div>

      <div className="chat-card__body inbox-thread__body">
        {!thread && (
          <div className="page-loading" role="status">
            <span className="page-loading__spinner" aria-hidden="true" />
            <strong>Please hold on while we open the conversation…</strong>
          </div>
        )}
        {thread && thread.messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.sender === 'staff' ? 'chat-msg--me' : ''}`}>
            <div className="chat-msg__bubble">
              <span className="chat-msg__who">{msg.sender === 'staff' ? (msg.sender_name || 'You') : 'Student'}</span>
              {msg.body}
              <time>{fmtDateTime(msg.created_at)}</time>
            </div>
          </div>
        ))}
        {thread?.studentTyping && (
          <div className="chat-msg">
            <div className="chat-msg__bubble typing-bubble" aria-live="polite">
              <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
              {thread.studentName || 'Student'} is typing…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {err && <div className="notice notice--err">{err}</div>}
      {note && <div className="notice notice--ok">{note}</div>}

      <div className="inbox-thread__actions">
        <input
          value={text}
          onChange={(e) => { setText(e.target.value); sendTyping(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Type your reply — it appears in their chat instantly…"
          aria-label="Type your reply"
        />
        <button className={`btn btn--navy btn--sm ${busy ? 'btn--busy' : ''}`} disabled={busy || !text.trim()} onClick={submit}>
          {busy ? ' ' : 'Send'}
        </button>
        <button className="btn btn--outline btn--sm" disabled={busy} onClick={emailReply} title="Email the latest reply to the student">
          <Mail size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />Email it
        </button>
        <button className="btn btn--outline btn--sm menu-list__danger" disabled={busy} onClick={() => setConfirmClose(true)}>
          Close conversation
        </button>
      </div>
      <p className="muted" style={{ fontSize: '.78rem', margin: '6px 2px 0' }}>
        "Send" posts to the live chat. "Email it" sends the latest reply to their inbox too.
        Closing the conversation ends it — the student sees "conversation closed".
      </p>

      {confirmClose && (
        <div className="modal-backdrop" onClick={() => setConfirmClose(false)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>Close this conversation?</h3>
            <p className="muted">
              The student is told it is closed. This cannot be undone.
            </p>
            <div className="row" style={{ gap: 10, marginTop: 14 }}>
              <button className="btn btn--navy" onClick={doClose} disabled={busy}>Yes, close it</button>
              <button className="btn btn--outline" onClick={() => setConfirmClose(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
