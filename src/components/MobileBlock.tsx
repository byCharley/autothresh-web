export function MobileBlock() {
  return (
    <div style={{
      minHeight: '100vh', background: '#0d0d0d',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    }}>
      {/* Icon */}
      <div style={{ marginBottom: 28 }}>
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
          <line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
      </div>

      {/* Branding */}
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: '#fff', marginBottom: 4 }}>
        AutoThresh Web{' '}
        <span style={{ color: '#e8a530' }}>Beta 1.0.0</span>
      </div>

      {/* Divider */}
      <div style={{ width: 32, height: 1, background: '#333', margin: '16px auto' }} />

      {/* Message */}
      <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
        Desktop Only
      </div>
      <div style={{ fontSize: 13, color: '#888', lineHeight: 1.7, maxWidth: 280 }}>
        AutoThresh Web is a professional print-separation tool designed for
        desktop use. Please visit{' '}
        <span style={{ color: '#e8a530', fontWeight: 600 }}>www.autothresh.com</span>
        {' '}on a desktop or laptop computer.
      </div>
    </div>
  );
}
