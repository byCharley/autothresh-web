import { useState } from 'react';
import { EulaModal } from './EulaModal';
import { FaqModal } from './FaqModal';
import { PageFooter } from './PageFooter';

interface Props {
  onLogin: () => void;
  onSwitchAccount?: () => void;
}

export function LoginPage({ onLogin, onSwitchAccount }: Props) {
  const [loading, setLoading]     = useState(false);
  const [showEula, setShowEula]   = useState(false);
  const [showFaq, setShowFaq]     = useState(false);

  const handleSignIn = () => {
    setLoading(true);
    onLogin();
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
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: '#f1f2f2', lineHeight: 1 }}>
            SepForge<span style={{ fontSize: 16, verticalAlign: 'super', lineHeight: 0 }}>™</span>
          </div>
          <span style={{ width: 1, height: 56, background: 'rgba(255,255,255,0.2)', display: 'block', flexShrink: 0 }} />
          <img
            src="/CharleyPangus_Favicon.svg"
            alt="Charley Pangus"
            style={{ height: 58, width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.9 }}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          Professional Separation Tool For Merch Designers
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
          {' '}store account to access SepForge.
          <br />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            You'll receive a one-time passcode by email.
          </span>
        </div>

        <div style={{
          fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          padding: '8px 12px', marginBottom: 20, textAlign: 'center',
          fontFamily: 'var(--font-mono)',
        }}>
          <span style={{ color: 'var(--accent)', marginRight: 6 }}>!</span>
          Use the email you purchased your subscription with at{' '}
          <a href="https://www.charleypangus.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>www.charleypangus.com</a>
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
          Access requires an active SepForge subscription.
        </div>

        {onSwitchAccount && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button
              onClick={onSwitchAccount}
              disabled={loading}
              style={{
                width: '100%', padding: '9px 20px',
                background: 'none', border: '1px solid var(--border)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <polyline points="16 11 18 13 22 9"/>
              </svg>
              Sign in with a different account
            </button>
          </div>
        )}
      </div>

      <PageFooter onEula={() => setShowEula(true)} onFaq={() => setShowFaq(true)} />
      {showEula && <EulaModal onClose={() => setShowEula(false)} />}
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}
    </div>
  );
}
