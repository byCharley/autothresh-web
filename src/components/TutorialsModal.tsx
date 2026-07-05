import { useState, useEffect } from 'react';

interface Tutorial {
  id: string;
  title: string;
  description: string;
  duration: string;
  youtube_id: string;
  coming_soon: boolean;
  sort_order: number;
}

const FALLBACK: Tutorial[] = [
  { id: '1', title: 'Getting Started', description: 'An overview of AutoThresh — uploading your first image, choosing a separation mode, and exporting your layers.', duration: '0:00', youtube_id: '80Fogz8q5_U', coming_soon: false, sort_order: 0 },
];

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

export function TutorialsModal({ onClose }: { onClose: () => void }) {
  const [tutorials, setTutorials] = useState<Tutorial[]>(FALLBACK);
  const [active, setActive]       = useState<Tutorial>(FALLBACK[0]);

  useEffect(() => {
    fetch('/api/tutorials')
      .then(r => r.ok ? r.json() as Promise<Tutorial[]> : null)
      .then(rows => {
        if (rows?.length) {
          setTutorials(rows);
          setActive(rows[0]);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 900,
        background: 'var(--bg, #111)',
        border: '1px solid var(--border)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column',
        maxHeight: 'calc(100vh - 40px)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', letterSpacing: '0.04em' }}>
              TUTORIALS
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
              color: 'var(--text-dim)',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{
          display: 'flex', flex: 1, minHeight: 0,
          flexDirection: window.innerWidth < 640 ? 'column' : 'row',
        }}>

          {/* Sidebar */}
          <div style={{
            width: window.innerWidth < 640 ? '100%' : 260,
            flexShrink: 0,
            borderRight: window.innerWidth < 640 ? 'none' : '1px solid var(--border)',
            borderBottom: window.innerWidth < 640 ? '1px solid var(--border)' : 'none',
            overflowY: 'auto',
          }}>
            {tutorials.map((t, i) => {
              const isActive = t.id === active.id;
              return (
                <button
                  key={t.id}
                  onClick={() => !t.coming_soon && setActive(t)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '12px 16px',
                    background: isActive ? 'var(--surface)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    borderRight: 'none', borderTop: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: t.coming_soon ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                    opacity: t.coming_soon ? 0.4 : 1,
                  }}
                >
                  <div style={{
                    width: 26, height: 26, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isActive ? 'var(--accent)' : 'var(--surface-2)',
                    color: isActive ? '#000' : 'var(--text-dim)',
                    fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  }}>
                    {isActive ? <PlayIcon /> : i + 1}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                      color: isActive ? 'var(--accent)' : 'var(--text)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {t.title}
                    </span>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                      {t.coming_soon ? 'Coming soon' : (t.duration || '')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Player pane */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', minWidth: 0 }}>

            {/* Video embed */}
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', flexShrink: 0 }}>
              {active.coming_soon ? (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 10, color: 'var(--text-dim)',
                }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', opacity: 0.5 }}>Coming soon</span>
                </div>
              ) : (
                <iframe
                  key={active.youtube_id}
                  src={`https://www.youtube.com/embed/${active.youtube_id}?rel=0&modestbranding=1`}
                  title={active.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                />
              )}
            </div>

            {/* Info */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                {active.title}
              </span>
              <p style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                {active.description}
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
