import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { AppIcon } from './AppIcon';

interface TopBarProps {
  onExport: () => void;
  onMockup: () => void;
  onPresets: () => void;
  onLogout?: () => void;
  userEmail?: string;
  firstName?: string;
  subscriptionExpiresAt?: string;
  planTitle?: string;
}

export function TopBar({ onExport, onMockup, onPresets, onLogout, userEmail, firstName, subscriptionExpiresAt, planTitle }: TopBarProps) {
  const { theme, setTheme, imageFileName, originalImage, clearImage, resetAllSettings } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const daysRemaining = subscriptionExpiresAt
    ? Math.ceil((new Date(subscriptionExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  const nextBillingFormatted = subscriptionExpiresAt
    ? new Date(subscriptionExpiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const displayName = firstName || userEmail || '';

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-logo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AppIcon size={22} color="var(--accent)" />
        <span>AutoThresh Web </span><span style={{ color: 'var(--accent)' }}>Beta 1.0.0</span>
      </div>

      <div className="topbar-divider" />

      {imageFileName && (
        <span className="topbar-filename">{imageFileName}</span>
      )}

      {originalImage && (
        <>
          <button
            className="btn btn-ghost"
            onClick={clearImage}
            title="Clear image and start over"
            style={{ fontSize: 11, fontFamily: 'var(--font-mono)', opacity: 0.6, marginLeft: 4 }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.6')}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
            </svg>
            New
          </button>
          <button
            className="btn btn-ghost"
            onClick={resetAllSettings}
            title="Reset all settings to defaults (keeps image)"
            style={{ fontSize: 11, fontFamily: 'var(--font-mono)', opacity: 0.6 }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.6')}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <polyline points="3 3 3 8 8 8"/>
            </svg>
            Reset
          </button>
        </>
      )}

      <div className="topbar-spacer" />

      {/* Theme toggle */}
      <button className="btn btn-ghost btn-icon" onClick={toggleTheme} title="Toggle theme">
        {theme === 'dark' ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        )}
      </button>

      <div className="topbar-divider" />

      {/* Signed-in user badge — click to open account dropdown */}
      {displayName && (
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              height: 26, padding: '0 10px',
              border: '1px solid var(--border)',
              background: menuOpen ? 'var(--surface-3, var(--surface-2))' : 'var(--surface-2)',
              cursor: 'pointer', marginRight: 6,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#3ecf4f', flexShrink: 0,
              boxShadow: '0 0 4px #3ecf4f88',
            }} />
            <span style={{
              fontSize: 11, color: 'var(--text)',
              maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {displayName}
            </span>
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
              style={{ opacity: 0.5, transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 6,
              width: 240,
              background: 'var(--surface)', border: '1px solid var(--border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 200,
            }}>
              {/* Account header */}
              <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Account
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)', marginBottom: 2, wordBreak: 'break-all' }}>
                  {userEmail}
                </div>
                {firstName && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
                    {firstName}
                  </div>
                )}
              </div>

              {/* Subscription info */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Subscription
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3ecf4f', boxShadow: '0 0 4px #3ecf4f88', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: '#3ecf4f', fontFamily: 'var(--font-mono)' }}>Active</span>
                </div>

                {planTitle && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Plan</span>
                    <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{planTitle}</span>
                  </div>
                )}

                {nextBillingFormatted && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Next billing</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{nextBillingFormatted}</span>
                  </div>
                )}

                {daysRemaining !== null && daysRemaining > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Days left</span>
                    <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{daysRemaining}</span>
                  </div>
                )}
              </div>

              {/* Sign out */}
              {onLogout && (
                <div style={{ padding: '8px' }}>
                  <button
                    onClick={() => { setMenuOpen(false); onLogout(); }}
                    style={{
                      width: '100%', padding: '8px 10px',
                      background: 'none', border: '1px solid var(--border)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16 17 21 12 16 7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <button
        className="btn btn-ghost"
        onClick={onPresets}
        title="Save and load layer presets"
        style={{ height: 26 }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        Presets
      </button>
      <button
        className="btn btn-ghost"
        onClick={onMockup}
        disabled={!originalImage}
        title="Preview artwork on shirt mockups"
        style={{ opacity: originalImage ? 1 : 0.4, height: 26 }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
          <path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/>
        </svg>
        Mockup
      </button>
      <button
        className="btn btn-primary"
        onClick={onExport}
        disabled={!originalImage}
        style={{ opacity: originalImage ? 1 : 0.4, height: 26, color: '#1a1a1a' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export
      </button>
    </header>
  );
}
