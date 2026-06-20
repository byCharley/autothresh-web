import { useStore } from '../store/useStore';
import { AppIcon } from './AppIcon';

interface TopBarProps {
  onExport: () => void;
  onLogout?: () => void;
  userEmail?: string;
  firstName?: string;
  subscriptionExpiresAt?: string;
}

export function TopBar({ onExport, onLogout, userEmail, firstName, subscriptionExpiresAt }: TopBarProps) {
  const { theme, setTheme, imageFileName, originalImage, clearImage } = useStore();

  const daysRemaining = subscriptionExpiresAt
    ? Math.ceil((new Date(subscriptionExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const displayName = firstName || userEmail || '';

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

      {/* Signed-in user badge */}
      {displayName && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '4px 10px', marginRight: 6,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}>
          {/* Green status dot */}
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#3ecf4f', flexShrink: 0,
            boxShadow: '0 0 4px #3ecf4f88',
          }} />
          <span style={{
            fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)',
            maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayName}
          </span>
          {daysRemaining !== null && daysRemaining > 0 && (
            <span style={{
              fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap', opacity: 0.7,
            }}>
              {daysRemaining}d
            </span>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              title="Sign out"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '0 2px', display: 'flex', alignItems: 'center',
                color: 'var(--text-dim)', opacity: 0.6,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.6')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          )}
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={onExport}
        disabled={!originalImage}
        style={{ opacity: originalImage ? 1 : 0.4 }}
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
