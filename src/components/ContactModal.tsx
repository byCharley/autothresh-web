import { useEffect, useRef, useState } from 'react';

const TYPES = ['Bug Report', 'Feature Request', 'Account Issue', 'General Question', 'Other'] as const;

interface Props { onClose: () => void; }

type Status = 'idle' | 'sending' | 'success' | 'error';

export function ContactModal({ onClose }: Props) {
  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [type,    setType]    = useState<typeof TYPES[number]>('General Question');
  const [message, setMessage] = useState('');
  const [status,  setStatus]  = useState<Status>('idle');
  const [errMsg,  setErrMsg]  = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    setStatus('sending');
    setErrMsg('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), type, message: message.trim() }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setStatus('success');
      } else {
        setErrMsg(data.error ?? 'Something went wrong.');
        setStatus('error');
      }
    } catch {
      setErrMsg('Network error. Please check your connection.');
      setStatus('error');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--bg)', border: '1px solid var(--border)',
    color: 'var(--text)', fontFamily: 'var(--font-mono)',
    fontSize: 11, padding: '7px 10px', outline: 'none',
    borderRadius: 2,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
    letterSpacing: '0.10em', textTransform: 'uppercase',
    color: 'var(--text-dim)', display: 'block', marginBottom: 5,
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: 480, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 2 }}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)' }}>
              Contact
            </span>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
              AutoThresh® Web
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, lineHeight: 1 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 22px' }}>
          {status === 'success' ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 14 }}>✓</div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.06em', marginBottom: 8 }}>
                Message Sent
              </p>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
                Thanks for reaching out. A confirmation has been sent to <strong>{email}</strong> and I'll get back to you as soon as possible.
              </p>
              <button className="btn btn-primary" onClick={onClose} style={{ minWidth: 100 }}>
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Name</label>
                  <input
                    ref={nameRef}
                    type="text" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Your name" required
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com" required
                    style={inputStyle}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Type</label>
                <select
                  value={type} onChange={(e) => setType(e.target.value as typeof TYPES[number])}
                  style={{ ...inputStyle, cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 28 }}
                >
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Message</label>
                <textarea
                  value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your question or issue…" required rows={5}
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 100, lineHeight: 1.6 }}
                />
              </div>

              {status === 'error' && (
                <p style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#ff4d4f', margin: 0 }}>
                  {errMsg}
                </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                <button type="button" className="btn" onClick={onClose} disabled={status === 'sending'}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={status === 'sending' || !name.trim() || !email.trim() || !message.trim()}>
                  {status === 'sending' ? 'Sending…' : 'Send Message'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
