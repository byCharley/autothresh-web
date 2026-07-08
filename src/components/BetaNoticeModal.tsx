import { useState } from 'react';

const STORAGE_KEY = 'at_beta_notice_dismissed';

export function shouldShowBetaNotice(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'true'; } catch { return true; }
}

interface Props {
  onClose: () => void;
  onContact?: () => void;
}

export function BetaNoticeModal({ onClose }: Props) {
  const [neverShow, setNeverShow] = useState(false);

  const handleClose = () => {
    if (neverShow) {
      try { localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* ignore */ }
    }
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        maxWidth: 460, width: '100%',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              background: 'var(--accent)', color: '#000',
              padding: '2px 6px',
            }}>
              Beta
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)' }}>
              AutoThresh™ Web
            </span>
          </div>
          <button
            onClick={handleClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, lineHeight: 1 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px 24px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.85, fontFamily: 'var(--font-sans)' }}>
          <p style={{ margin: '0 0 14px' }}>
            AutoThresh™ is an active work in progress. New features, improvements, and workflow updates
            ship regularly — and the roadmap is shaped directly by the{' '}
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>community using it</span>.
          </p>

          {/* Live chat callout */}
          <div style={{
            display: 'flex', gap: 14, alignItems: 'flex-start',
            padding: '14px 16px',
            background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-2))',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))',
            marginBottom: 14,
          }}>
            <div style={{
              flexShrink: 0, width: 34, height: 34, borderRadius: '50%',
              background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 4, letterSpacing: '0.04em' }}>
                Live Support Chat
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, fontFamily: 'var(--font-sans)' }}>
                Have a question, hit a bug, or want a feature? Use the{' '}
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>chat icon in the bottom right</span>.
                We respond fast and take every request seriously.
              </div>
            </div>
          </div>

          <p style={{ margin: 0 }}>
            Thank you for being part of this early — your input directly drives what gets built next.
          </p>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px 18px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
            userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={neverShow}
              onChange={(e) => setNeverShow(e.target.checked)}
              style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
            />
            Don't show again
          </label>
          <button
            className="btn btn-primary"
            onClick={handleClose}
            style={{ color: '#000', minWidth: 90 }}
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
}
