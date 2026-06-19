import { AppIcon } from './AppIcon';

export function MobileBlock() {
  return (
    <div style={{
      minHeight: '100vh', background: '#0d0d0d',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    }}>
      {/* App icon */}
      <div style={{ marginBottom: 24 }}>
        <AppIcon size={72} color="#e8a530" />
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
