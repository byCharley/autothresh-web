export function MobileBlock() {
  return (
    <div style={{
      minHeight: '100vh', background: '#0d0d0d',
      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
      backgroundSize: '28px 28px',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    }}>
      {/* Branding */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: '#f1f2f2', lineHeight: 1 }}>
          SepForge<span style={{ fontSize: 14, verticalAlign: 'super', lineHeight: 0 }}>™</span>
        </div>
        <span style={{ width: 1, height: 44, background: 'rgba(255,255,255,0.2)', display: 'block', flexShrink: 0 }} />
        <img
          src="/CharleyPangus_Favicon.svg"
          alt="Charley Pangus"
          style={{ height: 44, width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.9 }}
        />
      </div>

      {/* Divider */}
      <div style={{ width: 32, height: 1, background: '#333', margin: '4px auto 20px' }} />

      {/* Message */}
      <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
        Desktop + Tablet Only
      </div>
      <div style={{ fontSize: 13, color: '#888', lineHeight: 1.7, maxWidth: 280 }}>
        SepForge is designed for desktop and tablet use. Please visit{' '}
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>www.sepforge.com</span>
        {' '}on a desktop, laptop, or tablet.
      </div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 16, maxWidth: 260, lineHeight: 1.6 }}>
        Mobile support is coming in a future update.
      </div>
    </div>
  );
}
