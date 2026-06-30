import { useEffect } from 'react';

// ─── Changelog data ───────────────────────────────────────────────────────────
// Add a new entry at the top whenever a significant update ships.
// date format: YYYY-MM-DD  (used for localStorage "seen" tracking)

interface Entry {
  date: string;
  label: string;
  added?: string[];
  improved?: string[];
  changed?: string[];
  fixed?: string[];
}

export const CHANGELOG: Entry[] = [
  {
    date: '2026-06-30',
    label: 'CMYK Pro Fixes',
    improved: [
      'Adapt now instantly updates the canvas aspect ratio — switching preview modes (Raw, Inspect, Print Sim) no longer reverts to the previous document size.',
      'Print Sim loading bar reliably clears after processing completes and no longer gets stuck when switching modes.',
      'Clicking Inspect auto-clears any isolated (soloed) layer so the full composite is always visible.',
    ],
    added: [
      'Subscribe modal — choose Monthly ($11.99/mo) or Annual ($115.10/yr) plans with a 3-day free trial, accessible from the login screen.',
    ],
  },
  {
    date: '2026-06-26',
    label: 'Performance & Export',
    added: [
      'Document Bleed — expands the canvas around your artwork so registration marks never overlap the design.',
      'PSD layer names now include the ink\'s hex code (e.g. "C1 · #FF5500") so Photoshop shows color at a glance.',
      'Color Reference is now exported as a Photoshop layer (above all ink layers) when Include Color Info is checked.',
    ],
    improved: [
      'Color-sep mode is significantly faster — K-means clustering now runs once per image. Adjusting image exposure, contrast, or pattern settings no longer re-clusters from scratch.',
      'Eliminated a duplicate pixel-assignment pass during composite preview — roughly 2× faster per color-sep update.',
    ],
    changed: [
      'Registration Marks: the old "Bleed" slider is now "Mark Offset". A new "Bleed" slider controls canvas expansion.',
    ],
  },
  {
    date: '2026-06-22',
    label: 'UI & Defaults',
    added: [
      'Registration Marks moved into its own collapsible section below Document Setup.',
    ],
    improved: [
      'Color-sep swatches now display in a compact 3-column grid — up to 30 colors visible without scrolling.',
      'Zoom quality improved: all modes use smooth bilinear upscaling when zooming in. Dither mode keeps pixel-perfect nearest-neighbor rendering.',
      'Clicking "New" now fully clears the color palette and all color-sep colors so you start fresh.',
    ],
    changed: [
      'Document Setup is collapsed by default.',
      'Color-sep and all noise textures now default to Scale = 1.',
      'Color-sep mode defaults to Noise Standard pattern.',
    ],
  },
];

export const CHANGELOG_LATEST_DATE = CHANGELOG[0].date;
const LS_KEY = 'at-changelog-seen';

export function hasUnseenUpdates(): boolean {
  try {
    const seen = localStorage.getItem(LS_KEY);
    if (!seen) return true;
    return seen < CHANGELOG_LATEST_DATE;
  } catch { return false; }
}

export function markChangelogSeen() {
  try { localStorage.setItem(LS_KEY, CHANGELOG_LATEST_DATE); } catch { /* */ }
}

// ─── Tag component ────────────────────────────────────────────────────────────

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  NEW:      { bg: 'rgba(82, 196, 26, 0.15)',  text: '#52c41a' },
  IMPROVED: { bg: 'rgba(250, 173, 20, 0.15)', text: '#faad14' },
  CHANGED:  { bg: 'rgba(24, 144, 255, 0.15)', text: '#1890ff' },
  FIXED:    { bg: 'rgba(255, 77, 79, 0.15)',  text: '#ff4d4f' },
};

function Tag({ type }: { type: keyof typeof TAG_COLORS }) {
  const { bg, text } = TAG_COLORS[type];
  return (
    <span style={{
      display: 'inline-block', flexShrink: 0,
      fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700,
      letterSpacing: '0.10em', textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: 2,
      background: bg, color: text,
      marginTop: 1,
    }}>
      {type}
    </span>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props { onClose: () => void; onContact?: () => void; }

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function WhatsNewModal({ onClose, onContact }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        maxWidth: 580, width: '100%', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        borderRadius: 2,
      }}>

        {/* Header */}
        <div style={{
          padding: '18px 22px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)',
            }}>
              What's New
            </span>
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
              letterSpacing: '0.05em',
            }}>
              AutoThresh™ Web
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, lineHeight: 1 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '6px 0 16px' }}>
          {CHANGELOG.map((entry, ei) => (
            <div key={entry.date} style={{
              padding: '16px 22px 0',
              borderTop: ei > 0 ? '1px solid var(--border)' : undefined,
              marginTop: ei > 0 ? 6 : 0,
            }}>
              {/* Entry header */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                  color: 'var(--text)', letterSpacing: '0.04em',
                }}>
                  {formatDate(entry.date)}
                </span>
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)', letterSpacing: '0.04em',
                }}>
                  — {entry.label}
                </span>
              </div>

              {/* Change items */}
              {(['added', 'improved', 'changed', 'fixed'] as const).map((type) => {
                const items = entry[type];
                if (!items?.length) return null;
                const tagType = type === 'added' ? 'NEW'
                  : type === 'improved' ? 'IMPROVED'
                  : type === 'changed'  ? 'CHANGED'
                  : 'FIXED';
                return items.map((text, i) => (
                  <div key={`${type}-${i}`} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    marginBottom: 8, paddingLeft: 2,
                  }}>
                    <Tag type={tagType} />
                    <span style={{
                      fontSize: 11, color: 'var(--text-muted)',
                      fontFamily: 'var(--font-sans)', lineHeight: 1.6,
                      flex: 1,
                    }}>
                      {text}
                    </span>
                  </div>
                ));
              })}
            </div>
          ))}

          {/* Footer note */}
          <div style={{
            margin: '16px 22px 0',
            paddingTop: 14, borderTop: '1px solid var(--border)',
            fontSize: 10, fontFamily: 'var(--font-mono)',
            color: 'var(--text-dim)', lineHeight: 1.7,
          }}>
            Updates ship automatically — no reinstall needed.{' '}
            {onContact ? (
              <button onClick={onContact} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit' }}>
                Send feedback or report a bug →
              </button>
            ) : (
              <a href="https://charleypangus.com/pages/support" target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                Send feedback or report a bug →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
