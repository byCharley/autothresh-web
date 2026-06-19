import { useStore } from '../store/useStore';

interface TopBarProps {
  onExport: () => void;
}

export function TopBar({ onExport }: TopBarProps) {
  const { theme, setTheme, imageFileName, originalImage } = useStore();

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <header className="topbar">
      <div className="topbar-logo">
        <span>AutoThresh Web </span><span style={{ color: 'var(--accent)' }}>Beta 1.0.0</span>
      </div>

      <div className="topbar-divider" />

      {imageFileName && (
        <span className="topbar-filename">{imageFileName}</span>
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
