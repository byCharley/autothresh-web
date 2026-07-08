import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { AppIcon } from './AppIcon';

// Bell uses the same CHANGELOG as WhatsNewModal — one source, always in sync.
import { CHANGELOG, CHANGELOG_LATEST_DATE, markChangelogSeen } from './WhatsNewModal';
import { ACCENTS, ACCENT_KEY, applyAccentByHex, loadSavedAccent } from '../lib/accent';

function bellDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function bellBody(entry: typeof CHANGELOG[number]): string {
  const items = [...(entry.added ?? []), ...(entry.improved ?? [])];
  if (!items.length) return '';
  const joined = items.slice(0, 2).join(' · ');
  return joined.length > 300 ? joined.slice(0, 297) + '…' : joined;
}

function getSeenDate(): string {
  return localStorage.getItem('at-changelog-seen') ?? '';
}

interface TopBarProps {
  onExport: () => void;
  onMockup: () => void;
  onPresets: () => void;
  onTutorial: () => void;
  onVideo: () => void;
  onAnalytics?: () => void;
  onLogout?: () => void;
  userEmail?: string;
  firstName?: string;
  subscriptionExpiresAt?: string;
  planTitle?: string;
  subscriptionStatus?: string;
  sessionToken?: string;
  chatUnread?: number;
}

export function TopBar({ onExport, onMockup, onPresets, onTutorial, onVideo, onAnalytics, onLogout, userEmail, firstName, subscriptionExpiresAt, planTitle, subscriptionStatus, sessionToken, chatUnread = 0 }: TopBarProps) {
  const { theme, setTheme, imageFileName, originalImage, clearImage, resetAllSettings, historyStack, undo, passthroughMode, setPassthroughMode } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [notifAtBottom, setNotifAtBottom] = useState(false);
  const notifScrollRef = useRef<HTMLDivElement>(null);
  const [seenDate, setSeenDate] = useState(getSeenDate);
  const unreadCount = CHANGELOG.filter(e => e.date > seenDate).length;
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);
  const [activeAccent, setActiveAccent] = useState(() => localStorage.getItem(ACCENT_KEY) ?? '#FF6B1A');

  useEffect(() => { loadSavedAccent(); }, []);

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  useEffect(() => {
    if (!gearOpen) return;
    const handler = (e: MouseEvent) => {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [gearOpen]);

  return (
    <header className="topbar">
      <div className="topbar-logo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AppIcon size={22} color="var(--accent)" />
        <span>AutoThresh Web </span><span style={{ color: 'var(--accent)' }}>Beta 1.0.2</span>
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

      {/* Passthrough mode toggle */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
        onMouseEnter={e => { const t = e.currentTarget.querySelector('.pt-tip') as HTMLElement; if (t) t.style.opacity = '1'; }}
        onMouseLeave={e => { const t = e.currentTarget.querySelector('.pt-tip') as HTMLElement; if (t) t.style.opacity = '0'; }}
      >
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setPassthroughMode(!passthroughMode)}
          style={{
            height: 26, width: 30,
            color: passthroughMode ? 'var(--accent)' : undefined,
            opacity: passthroughMode ? 1 : 0.5,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/>
            <line x1="12" y1="2" x2="12" y2="12"/>
          </svg>
        </button>
        <div className="pt-tip" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          width: 230, padding: '8px 10px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          lineHeight: 1.6, zIndex: 300, pointerEvents: 'none',
          opacity: 0, transition: 'opacity 0.12s',
          whiteSpace: 'normal',
        }}>
          <span style={{ color: 'var(--text)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
            {passthroughMode ? 'Passthrough ON' : 'Passthrough OFF'}
          </span>
          Turns off all separation and pattern effects but keeps textures active. Useful for clean PNG exports with distress effects only.
        </div>
      </div>

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
            const subColor = subscriptionStatus === 'creator'  ? 'var(--accent)'
              : subscriptionStatus === 'tester'                ? '#38bdf8'
              : subscriptionStatus === 'trial'                 ? '#a78bfa'
              : subscriptionStatus === 'lifetime'              ? '#fbbf24'
              : subscriptionStatus === 'paused' || subscriptionStatus === 'cancelled' ? '#e6a817'
              : '#3ecf4f';
            const subLabel = subscriptionStatus === 'creator' ? 'Creator'
              : subscriptionStatus === 'tester' ? 'Tester'
              : subscriptionStatus === 'trial' ? 'Free Trial'
              : subscriptionStatus === 'lifetime' ? 'Lifetime'
              : subscriptionStatus === 'paused' ? 'Paused'
              : subscriptionStatus === 'cancelled' ? 'Cancelled'
              : 'Active';
            return (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 6,
                width: 260,
                background: 'var(--surface)', border: '1px solid var(--border)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                zIndex: 200,
              }}>
                {/* Identity */}
                <div style={{ padding: '13px 15px 11px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                      {firstName || userEmail?.split('@')[0]}
                    </span>
                    {subscriptionStatus === 'creator' && (
                      <span style={{
                        fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em',
                        textTransform: 'uppercase', color: '#111',
                        background: subColor, padding: '2px 6px', borderRadius: 2,
                      }}>
                        Creator
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {userEmail}
                  </div>
                </div>

                {/* Plan — hidden for creator */}
                {subscriptionStatus !== 'creator' && (
                <div style={{ padding: '11px 15px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: nextBillingFormatted || (daysRemaining !== null && daysRemaining > 0) ? 7 : 0 }}>
                    <span style={{
                      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: '#111',
                      background: subColor, padding: '2px 7px', borderRadius: 2,
                    }}>
                      {subLabel}
                    </span>
                    {planTitle && (
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                        {planTitle}
                      </span>
                    )}
                  </div>
                  {(nextBillingFormatted || (daysRemaining !== null && daysRemaining > 0)) && (
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      {subscriptionStatus === 'trial' ? 'Trial ends' : subscriptionStatus === 'lifetime' ? 'Never expires' : 'Renews'}{subscriptionStatus !== 'lifetime' && nextBillingFormatted ? ` ${nextBillingFormatted}` : ''}
                      {daysRemaining !== null && daysRemaining > 0 && (
                        <span style={{ color: 'var(--text-muted)', marginLeft: 5 }}>· {daysRemaining}d left</span>
                      )}
                    </div>
                  )}
                </div>
                )}

                {/* Actions */}
                <div style={{ padding: '7px 15px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {onLogout && (
                    <button
                      onClick={() => { setMenuOpen(false); onLogout(); }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                        transition: 'color 0.12s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; }}
                    >
                      Sign out
                    </button>
                  )}
                  <a
                    href="https://www.charleypangus.com/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    style={{
                      border: '1px solid var(--border)', cursor: 'pointer',
                      padding: '4px 10px', fontSize: 10,
                      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                      textDecoration: 'none', transition: 'border-color 0.12s, color 0.12s',
                    }}
                    onMouseEnter={(e) => { const a = e.currentTarget as HTMLAnchorElement; a.style.borderColor = 'var(--accent)'; a.style.color = 'var(--accent)'; }}
                    onMouseLeave={(e) => { const a = e.currentTarget as HTMLAnchorElement; a.style.borderColor = 'var(--border)'; a.style.color = 'var(--text-muted)'; }}
                  >
                    Manage subscription
                  </a>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Analytics button — creator only */}
      {subscriptionStatus === 'creator' && onAnalytics && (
        <button
          className="btn btn-ghost btn-icon"
          title={chatUnread > 0 ? `Command Center · ${chatUnread} unread` : 'Command Center'}
          onClick={onAnalytics}
          style={{ height: 26, width: 30, position: 'relative' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          {chatUnread > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 2,
              width: 7, height: 7, borderRadius: '50%',
              background: '#ef4444',
              border: '1.5px solid var(--bg)',
              display: 'block',
            }} />
          )}
        </button>
      )}

      {/* Accent color picker */}
      <div ref={gearRef} style={{ position: 'relative' }}>
        <button
          className="btn btn-ghost btn-icon"
          title="Theme color"
          onClick={() => setGearOpen(v => !v)}
          style={{ height: 26, width: 30 }}
          data-tutorial="tutorial-theme"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>

        {gearOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            background: 'var(--surface)', border: '1px solid var(--border)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            padding: '14px 16px', zIndex: 200, minWidth: 180,
          }}>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 12 }}>
              Accent Color
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ACCENTS.map(a => (
                <button
                  key={a.accent}
                  onClick={() => {
                    applyAccentByHex(a.accent);
                    setActiveAccent(a.accent);
                    setGearOpen(false);
                    if (sessionToken) {
                      fetch('/api/presets?type=prefs', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'Authorization': sessionToken },
                        body: JSON.stringify({ accentColor: a.accent }),
                      }).catch(() => {});
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: activeAccent === a.accent ? 'var(--surface-2)' : 'none',
                    border: `1px solid ${activeAccent === a.accent ? 'var(--border)' : 'transparent'}`,
                    padding: '6px 8px', cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: a.accent, flexShrink: 0,
                    boxShadow: activeAccent === a.accent ? `0 0 6px ${a.accent}` : 'none',
                  }} />
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {a.name}
                  </span>
                  {activeAccent === a.accent && (
                    <svg style={{ marginLeft: 'auto' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Changelog bell */}
      <div ref={notifRef} style={{ position: 'relative' }}>
        <button
          className="btn btn-ghost btn-icon"
          title="What's new"
          onClick={() => {
            const opening = !notifOpen;
            setNotifOpen(opening);
            if (opening) { markChangelogSeen(); setSeenDate(CHANGELOG_LATEST_DATE); setNotifAtBottom(false); }
          }}
          style={{ position: 'relative', height: 26, width: 30 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: 3, right: 3,
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 5px var(--accent)',
            }} />
          )}
        </button>

        {notifOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            width: 320,
            background: 'var(--surface)', border: '1px solid var(--border)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            zIndex: 200,
          }}>
            <div style={{
              padding: '11px 14px 10px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text)' }}>
                What's New
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                AutoThresh
              </span>
            </div>
            <div style={{ position: 'relative' }}>
              <div
                ref={notifScrollRef}
                style={{ maxHeight: 420, overflowY: 'auto' }}
                onScroll={() => {
                  const el = notifScrollRef.current;
                  if (!el) return;
                  setNotifAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 8);
                }}
              >
                {CHANGELOG.map((entry, i) => {
                  const unseen = entry.date > seenDate;
                  return (
                    <div key={entry.date + entry.label} style={{
                      padding: '12px 14px',
                      borderBottom: i < CHANGELOG.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex', gap: 10,
                      opacity: i >= 4 ? Math.max(0.35, 0.65 - (i - 4) * 0.1) : 1,
                      animation: `notif-row-in 0.22s cubic-bezier(0.22, 0.61, 0.36, 1) ${i * 55}ms both`,
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                        background: unseen ? 'var(--accent)' : 'var(--border)',
                        boxShadow: unseen ? '0 0 5px var(--accent)' : 'none',
                      }} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                            {entry.label}
                          </span>
                          <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                            {bellDate(entry.date)}
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0, fontFamily: 'var(--font-mono)' }}>
                          {bellBody(entry)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 64,
                background: 'linear-gradient(to bottom, transparent, var(--surface))',
                pointerEvents: 'none',
                opacity: notifAtBottom ? 0 : 1,
                transition: 'opacity 0.25s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      <button
        className="btn btn-ghost"
        onClick={onVideo}
        title="Watch video tutorials"
        style={{ height: 26 }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
          <circle cx="12" cy="12" r="10"/>
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>
        </svg>
        Tutorials
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
