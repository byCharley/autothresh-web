import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { AppIcon } from './AppIcon';

interface TopBarProps {
  onExport: () => void;
  onMockup: () => void;
  onPresets: () => void;
  onTutorial: () => void;
  onVideo: () => void;
  onLogout?: () => void;
  userEmail?: string;
  firstName?: string;
  subscriptionExpiresAt?: string;
  planTitle?: string;
  subscriptionStatus?: string;
}

export function TopBar({ onExport, onMockup, onPresets, onTutorial, onVideo, onLogout, userEmail, firstName, subscriptionExpiresAt, planTitle, subscriptionStatus }: TopBarProps) {
  const { theme, setTheme, imageFileName, originalImage, clearImage, resetAllSettings, historyStack, undo } = useStore();
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
          {historyStack.length > 0 && (
            <button
              className="btn btn-ghost"
              onClick={undo}
              title={`Undo (${historyStack.length} step${historyStack.length !== 1 ? 's' : ''} available)`}
              style={{ fontSize: 11, fontFamily: 'var(--font-mono)', opacity: 0.6 }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.6')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                <path d="M9 14L4 9l5-5"/><path d="M4 9h10a7 7 0 0 1 0 14h-1"/>
              </svg>
              Undo
            </button>
          )}
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

          {menuOpen && (() => {
            const subColor = subscriptionStatus === 'tester'  ? '#38bdf8'
              : subscriptionStatus === 'trial'                ? '#a78bfa'
              : subscriptionStatus === 'paused' || subscriptionStatus === 'cancelled' ? '#e6a817'
              : '#3ecf4f';
            const subLabel = subscriptionStatus === 'tester' ? 'Tester'
              : subscriptionStatus === 'trial' ? 'Free Trial'
              : subscriptionStatus === 'paused' ? 'Paused'
              : subscriptionStatus === 'cancelled' ? 'Cancelled'
              : 'Active';
            const initial = (firstName || userEmail || '?')[0].toUpperCase();

            return (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 6,
                width: 232,
                background: 'var(--surface)', border: '1px solid var(--border)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                zIndex: 200,
              }}>
                {/* Identity row */}
                <div style={{ padding: '14px 14px 12px', display: 'flex', alignItems: 'center', gap: 11, borderBottom: '1px solid var(--border)' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--accent)', color: '#111',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  }}>
                    {initial}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {firstName && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                        {firstName}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {userEmail}
                    </div>
                  </div>
                </div>

                {/* Subscription row */}
                <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: subColor, boxShadow: `0 0 5px ${subColor}99`,
                      }} />
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: subColor, fontWeight: 600 }}>
                        {subLabel}
                      </span>
                    </div>
                    {planTitle && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                        {planTitle}
                      </span>
                    )}
                  </div>

                  {(nextBillingFormatted || (daysRemaining !== null && daysRemaining > 0)) && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                        {subscriptionStatus === 'trial' ? 'Trial ends' : 'Next billing'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {nextBillingFormatted && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{nextBillingFormatted}</span>
                        )}
                        {daysRemaining !== null && daysRemaining > 0 && (
                          <span style={{
                            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                            color: '#111', background: subscriptionStatus === 'trial' ? '#a78bfa' : 'var(--accent)',
                            padding: '1px 6px', borderRadius: 2,
                          }}>
                            {daysRemaining}d
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Sign out */}
                {onLogout && (
                  <div style={{ padding: '6px 14px 10px' }}>
                    <button
                      onClick={() => { setMenuOpen(false); onLogout(); }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0',
                        fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                        transition: 'color 0.12s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                      </svg>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      <button
        className="btn btn-ghost"
        onClick={onVideo}
        title="Watch the full video tutorial"
        style={{ height: 26 }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
          <circle cx="12" cy="12" r="10"/>
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>
        </svg>
        Watch Tutorial
      </button>
      <button
        className="btn btn-ghost"
        onClick={onTutorial}
        title="Take a quick tour of the tools"
        style={{ height: 26 }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="8" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="12" y1="12" x2="12" y2="16" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        Tour
      </button>
      <button
        className="btn btn-ghost"
        onClick={onPresets}
        title="Save and load layer presets"
        style={{ height: 26 }}
        data-tutorial="tutorial-presets"
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
        data-tutorial="tutorial-mockup"
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
        data-tutorial="tutorial-export"
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
