interface Props {
  onClose: () => void;
}

export function FaqModal({ onClose }: Props) {
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
        maxWidth: 540, width: '100%', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)' }}>
            FAQ — SepForge
          </span>
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
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.85, fontFamily: 'var(--font-sans)' }}>

          <Item n={1} q="What is SepForge?">
            SepForge is a browser-based screen print separation tool built for screen printers,
            printmakers, and creatives who need precise, repeatable separations without the
            complexity of traditional workflows. Designed by Charley Pangus, it supports
            tonal threshold, CMYK, simulated process, dither, color separation, and vector
            modes — all directly in your browser, no downloads, no plugins, no Photoshop required.
          </Item>

          <Item n={2} q="Is SepForge related to AutoThresh?">
            SepForge evolved from the AutoThresh separation engine but goes far beyond it.
            Where AutoThresh focused on tonal threshold separations, SepForge covers the
            full range of screen print workflows — CMYK, simulated process, dither, color
            separation, vector tracing, texture overlays, and more. It's a complete
            rebrand reflecting how much more the tool can do.
          </Item>

          <Item n={3} q="Can I pause or cancel my subscription anytime?">
            Yes! You can manage your subscription at any time. Visit{' '}
            <a href="https://www.charleypangus.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              www.charleypangus.com
            </a>{' '}
            and sign in using the email you subscribed with to pause, cancel, or update your plan.
          </Item>

          <Item n={4} q="I'm having issues — how can I get help?">
            Visit the{' '}
            <a href="https://charleypangus.com/pages/support" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              support section
            </a>{' '}
            at charleypangus.com for help, troubleshooting guides, and direct contact options.
          </Item>

        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
          <button
            className="btn btn-primary"
            onClick={onClose}
            style={{ width: '100%', color: '#000' }}
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
}

function Item({ n, q, children }: { n: number; q: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
        color: 'var(--text)', marginBottom: 6,
      }}>
        {n}. {q}
      </div>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  );
}
