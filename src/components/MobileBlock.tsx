import { AppIcon } from './AppIcon';

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
      {/* App icon */}
      <div style={{ marginBottom: 24 }}>
        <AppIcon size={72} color="var(--accent)" />
      </div>

      {/* Branding */}
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: '#fff', marginBottom: 4 }}>
        SepForge™{' '}
        <span style={{ color: 'var(--accent)' }}>Beta 1.0.0</span>
      </div>

      {/* Divider */}
      <div style={{ width: 32, height: 1, background: '#333', margin: '16px auto' }} />

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
