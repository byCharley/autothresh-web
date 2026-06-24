import { useState } from 'react';
import { AppIcon } from './AppIcon';
import { EulaModal } from './EulaModal';
import { PageFooter } from './PageFooter';

interface Props {
  onLogin: () => Promise<void>;
}

export function LoginPage({ onLogin }: Props) {
  const [loading, setLoading]     = useState(false);
  const [showEula, setShowEula]   = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    await onLogin();
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
      backgroundSize: '28px 28px',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <AppIcon size={80} color="var(--accent)" />
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
          AutoThresh Web <span style={{ color: 'var(--accent)' }}>Beta 1.0.0</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          Professional Tonal Separation Tool
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        width: 360, maxWidth: '90vw', padding: '32px 28px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 28 }}>
          Sign in with your{' '}
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>Charley Pangus</span>
          {' '}store account to access AutoThresh Web.
          <br />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            You'll receive a one-time passcode by email.
          </span>
        </div>

        <div style={{
          fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          padding: '8px 12px', marginBottom: 20, textAlign: 'left',
          fontFamily: 'var(--font-mono)',
        }}>
          <span style={{ color: 'var(--accent)', marginRight: 6 }}>!</span>
          Use the email you subscribed with at{' '}
          <span style={{ color: 'var(--text)' }}>charleypangus.com</span>
        </div>

        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            width: '100%', padding: '12px 20px',
            background: loading ? 'var(--surface-2)' : 'var(--accent)',
            border: '1px solid transparent',
            cursor: loading ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
            color: loading ? 'var(--text-muted)' : '#000',
            fontFamily: 'var(--font-mono)',
            transition: 'opacity 0.15s',
          }}
        >
          {loading ? (
            <span style={{ opacity: 0.5 }}>Redirecting…</span>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.1 8.5h-1.4c-.3-2.2-2.1-3.9-4.4-3.9S7 6.3 6.7 8.5H5.3c-.7 0-1.3.6-1.3 1.3v8.5c0 .7.6 1.2 1.3 1.2h11.5c.7 0 1.2-.5 1.2-1.2V9.8c0-.7-.5-1.3-1.2-1.3zm-4.8-2.4c1.4 0 2.6 1 2.9 2.4H9.5c.2-1.4 1.4-2.4 2.8-2.4zm0 8.4c-1.3 0-2.3-1-2.3-2.3s1-2.3 2.3-2.3 2.3 1 2.3 2.3-1 2.3-2.3 2.3z"/>
              </svg>
              Sign In with Shopify
            </>
          )}
        </button>

        <div style={{ marginTop: 16, fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>
          Access requires an active AutoThresh subscription.
        </div>
      </div>

      <PageFooter onEula={() => setShowEula(true)} />
      {showEula && <EulaModal onClose={() => setShowEula(false)} />}
    </div>
  );
}
