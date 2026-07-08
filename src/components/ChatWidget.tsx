import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../auth/useAuth';

interface Ticket {
  id: string;
  subject: string;
  status: 'open' | 'pending' | 'solved';
  created_at: string;
  last_message_at: string;
  unread_by_user: number;
  user_name: string;
}

interface Message {
  id: number;
  created_at: string;
  sender: 'user' | 'creator';
  message: string;
  read_at: string | null;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const STATUS_COLOR = { open: '#4ade80', pending: '#faad14', solved: '#6b7280' } as const;
const STATUS_LABEL = { open: 'Open', pending: 'Awaiting reply', solved: 'Solved' } as const;

export function ChatWidget({ session }: { session: Session }) {
  const [open, setOpen]               = useState(false);
  const [creatorOnline, setCreatorOnline] = useState(false);
  const [tickets, setTickets]         = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [subject, setSubject]         = useState('');
  const [firstMsg, setFirstMsg]       = useState('');
  const [reply, setReply]             = useState('');
  const [sending, setSending]         = useState(false);
  const [unread, setUnread]           = useState(0);
  const [view, setView]               = useState<'chat' | 'new'>('chat');
  const bottomRef                     = useRef<HTMLDivElement>(null);
  const replyRef                      = useRef<HTMLTextAreaElement>(null);

  const authH = useCallback(() => ({ Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }), [session.token]);

  const loadStatus = useCallback(() => {
    fetch('/api/chat?resource=status')
      .then(r => r.ok ? r.json() : null)
      .then((d: { is_online?: boolean } | null) => setCreatorOnline(!!d?.is_online))
      .catch(() => {});
  }, []);

  const loadTickets = useCallback(() => {
    fetch('/api/chat?resource=tickets', { headers: authH() })
      .then(r => r.ok ? r.json() as Promise<Ticket[]> : Promise.resolve([] as Ticket[]))
      .then(ts => {
        setTickets(ts);
        setUnread(ts.reduce((s, t) => s + (t.unread_by_user || 0), 0));
        if (!activeTicket) {
          const first = ts.find(t => t.status !== 'solved');
          if (first) setActiveTicket(first);
        }
      })
      .catch(() => {});
  }, [session.token, activeTicket]);

  const loadMessages = useCallback((ticketId: string) => {
    fetch(`/api/chat?resource=messages&ticket=${ticketId}`, { headers: authH() })
      .then(r => r.ok ? r.json() as Promise<Message[]> : Promise.resolve([] as Message[]))
      .then(msgs => {
        setMessages(msgs);
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, unread_by_user: 0 } : t));
        setUnread(prev => Math.max(0, prev));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      })
      .catch(() => {});
  }, [session.token]);

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 30_000);
    return () => clearInterval(id);
  }, [loadStatus]);

  useEffect(() => {
    loadTickets();
    const id = setInterval(loadTickets, open ? 10_000 : 60_000);
    return () => clearInterval(id);
  }, [open, loadTickets]);

  useEffect(() => {
    if (!open || !activeTicket) return;
    loadMessages(activeTicket.id);
    const id = setInterval(() => loadMessages(activeTicket.id), 5_000);
    return () => clearInterval(id);
  }, [open, activeTicket?.id, loadMessages]);

  // auto-open new ticket form if no open ticket when widget opens
  useEffect(() => {
    if (open) {
      const hasOpen = tickets.some(t => t.status !== 'solved');
      setView(hasOpen ? 'chat' : 'new');
    }
  }, [open]);

  async function submitTicket() {
    if (!subject.trim() || !firstMsg.trim() || sending) return;
    setSending(true);
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: authH(),
        body: JSON.stringify({ resource: 'ticket', subject: subject.trim(), message: firstMsg.trim() }),
      });
      const data = await r.json() as Ticket & { error?: string; ticket_id?: string };
      if (r.status === 409 && data.ticket_id) {
        const ex = tickets.find(t => t.id === data.ticket_id);
        if (ex) { setActiveTicket(ex); setView('chat'); }
      } else if (r.ok) {
        setActiveTicket(data);
        setTickets(prev => [data, ...prev]);
        setSubject(''); setFirstMsg('');
        setView('chat');
        loadMessages(data.id);
      }
    } catch {}
    setSending(false);
  }

  async function sendReply() {
    if (!reply.trim() || !activeTicket || sending) return;
    const text = reply.trim();
    setSending(true);
    setReply('');
    await fetch('/api/chat', {
      method: 'POST', headers: authH(),
      body: JSON.stringify({ resource: 'message', ticket_id: activeTicket.id, message: text }),
    });
    loadMessages(activeTicket.id);
    setSending(false);
  }

  const hasOpenTicket = tickets.some(t => t.status !== 'solved');
  const isMobile = window.innerWidth < 640;

  // ── Panel ──────────────────────────────────────────────────────────────────
  const panel = (
    <div style={{
      position: 'fixed',
      ...(isMobile
        ? { inset: 0 }
        : { bottom: 80, right: 24, width: 340, height: 530, borderRadius: 0 }),
      background: 'var(--bg, #111)',
      border: isMobile ? 'none' : '1px solid var(--border)',
      boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
      display: 'flex', flexDirection: 'column',
      zIndex: 920,
      overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', letterSpacing: '0.04em' }}>Support</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: creatorOnline ? '#4ade80' : '#6b7280' }} />
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{creatorOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {hasOpenTicket && view === 'chat' && (
            <button onClick={() => setView('new')} style={{ height: 22, padding: '0 8px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer' }}>
              + New
            </button>
          )}
          {view === 'new' && hasOpenTicket && (
            <button onClick={() => setView('chat')} style={{ height: 22, padding: '0 8px', fontSize: 9, fontFamily: 'var(--font-mono)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer' }}>
              ← Back
            </button>
          )}
          <button onClick={() => setOpen(false)} style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-dim)' }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* New ticket form */}
      {view === 'new' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto' }}>
          <div style={{ padding: '16px 14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Subject</div>
              <select
                value={subject}
                onChange={e => setSubject(e.target.value)}
                style={{ width: '100%', height: 32, padding: '0 10px', fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: subject ? 'var(--text)' : 'var(--text-dim)', boxSizing: 'border-box', cursor: 'pointer' }}
              >
                <option value="" disabled>Select a category…</option>
                <option value="Account">Account</option>
                <option value="Billing">Billing</option>
                <option value="Report a Bug">Report a Bug</option>
                <option value="Questions">Questions</option>
                <option value="Requests">Requests</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Message</div>
              <textarea
                placeholder="Feel free to ask anything — we're happy to help!"
                value={firstMsg}
                onChange={e => setFirstMsg(e.target.value)}
                rows={5}
                style={{ width: '100%', padding: '8px 10px', fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', resize: 'none', boxSizing: 'border-box', lineHeight: 1.6 }}
              />
            </div>
          </div>
          <div style={{ padding: '10px 14px' }}>
            <button
              onClick={submitTicket}
              disabled={sending || !subject.trim() || !firstMsg.trim()}
              style={{
                width: '100%', height: 36, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                background: 'var(--accent)', border: 'none', color: '#000', cursor: 'pointer',
                opacity: (!subject.trim() || !firstMsg.trim() || sending) ? 0.5 : 1,
              }}
            >
              {sending ? 'Sending…' : 'Send Message'}
            </button>
          </div>
          {tickets.filter(t => t.status === 'solved').length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Past tickets</div>
              {tickets.filter(t => t.status === 'solved').slice(0, 3).map(t => (
                <button key={t.id} onClick={() => { setActiveTicket(t); setView('chat'); }} style={{ width: '100%', textAlign: 'left', padding: '5px 0', background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 10, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>
                  ✓ {t.subject}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conversation */}
      {view === 'chat' && activeTicket && (
        <>
          {/* Ticket info bar */}
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{activeTicket.subject}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[activeTicket.status] }} />
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{STATUS_LABEL[activeTicket.status]}</span>
              </div>
            </div>
            {tickets.length > 1 && (
              <select
                value={activeTicket.id}
                onChange={e => {
                  const t = tickets.find(x => x.id === e.target.value);
                  if (t) { setActiveTicket(t); setMessages([]); }
                }}
                style={{ height: 24, padding: '0 4px', fontSize: 9, fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer' }}
              >
                {tickets.map(t => <option key={t.id} value={t.id}>{t.subject.slice(0, 22)}{t.subject.length > 22 ? '…' : ''}</option>)}
              </select>
            )}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>No messages yet</div>
            )}
            {messages.map((msg, idx) => {
              const isUser = msg.sender === 'user';
              const showDate = idx === 0 || fmtDate(messages[idx - 1].created_at) !== fmtDate(msg.created_at);
              const isLast = idx === messages.length - 1;
              const isRead = isUser && isLast && msg.read_at !== null;
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div style={{ textAlign: 'center', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', margin: '4px 0 8px' }}>{fmtDate(msg.created_at)}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', gap: 2, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                      {!isUser && (
                        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginLeft: 2 }}>Support</span>
                      )}
                      <div style={{
                        padding: '8px 11px', fontSize: 12, lineHeight: 1.55,
                        fontFamily: 'var(--font-sans)',
                        background: isUser ? 'var(--accent)' : 'var(--surface)',
                        color: isUser ? '#111' : 'var(--text)',
                        border: isUser ? 'none' : '1px solid var(--border)',
                        wordBreak: 'break-word',
                      }}>
                        {msg.message}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{fmtTime(msg.created_at)}</span>
                        {isUser && isLast && (
                          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: isRead ? 'var(--accent)' : 'var(--text-dim)' }}>
                            {isRead ? '✓✓ Read' : '✓ Sent'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Solved system message — appears in-thread when ticket is closed */}
            {activeTicket.status === 'solved' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 2 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', color: '#4ade80', textTransform: 'uppercase' }}>
                      Support Ticket Solved
                    </span>
                  </div>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                  This conversation has been closed
                </span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Reply / solved state */}
          {activeTicket.status === 'solved' ? (
            <div style={{ padding: '14px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'rgba(74,222,128,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>Chat Closed</div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Your issue has been resolved</div>
                </div>
              </div>
              <button
                onClick={() => setView('new')}
                style={{ width: '100%', height: 32, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
              >
                Open New Ticket
              </button>
            </div>
          ) : (
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <textarea
                  ref={replyRef}
                  placeholder="Type a message…"
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }}
                  rows={2}
                  style={{
                    flex: 1, padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font-mono)',
                    background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)',
                    resize: 'none', lineHeight: 1.5,
                  }}
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  style={{
                    width: 36, flexShrink: 0, background: 'var(--accent)', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: (!reply.trim() || sending) ? 0.4 : 1,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
              <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 4 }}>⌘↵ to send</div>
            </div>
          )}
        </>
      )}

      {/* No tickets yet */}
      {view === 'chat' && !activeTicket && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" opacity="0.4">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textAlign: 'center' }}>No open tickets</span>
          <button onClick={() => setView('new')} style={{ height: 32, padding: '0 16px', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'var(--accent)', border: 'none', color: '#000', cursor: 'pointer' }}>
            Start a conversation
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {open && panel}

      {/* Floating bubble */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'fixed',
          bottom: isMobile ? 'calc(64px + env(safe-area-inset-bottom, 0px) + 12px)' : 24,
          right: isMobile ? 16 : 24,
          zIndex: 921,
          width: 52, height: 52,
          background: open ? 'var(--surface-2)' : 'var(--accent)',
          border: open ? '1px solid var(--border)' : 'none',
          borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}
      >
        {/* Online dot */}
        <div style={{
          position: 'absolute', top: 3, right: 3,
          width: 10, height: 10, borderRadius: '50%',
          background: creatorOnline ? '#4ade80' : '#6b7280',
          border: '2px solid var(--bg, #111)',
        }} />

        {/* Unread badge */}
        {unread > 0 && (
          <div style={{
            position: 'absolute', top: -2, left: -2,
            minWidth: 18, height: 18, borderRadius: 9, padding: '0 4px',
            background: '#f87171', color: '#000',
            fontSize: 9, fontWeight: 800, fontFamily: 'var(--font-mono)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--bg, #111)',
          }}>
            {unread > 9 ? '9+' : unread}
          </div>
        )}

        {open ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        )}
      </button>
    </>
  );
}
