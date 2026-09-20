import { useEffect, useRef } from 'react';
import { AppIcon } from './AppIcon';
import { PRODUCT_URL } from '../lib/product';

interface Props {
  onSignIn: () => void;
}

export function TrialEndedPage({ onSignIn }: Props) {
  const cancelled = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!cancelled.current) window.location.assign(PRODUCT_URL);
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  const stayAndSignIn = () => {
    cancelled.current = true;
    onSignIn();
  };

  return (
    <div style={{
      minHeight: '100%',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: 'var(--font-sans)',
      boxSizing: 'border-box',
    }}>
      <AppIcon size={56} color="#f1f2f2" />
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 20, letterSpacing: '-0.02em' }}>
        Your 3-day trial has ended
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center', maxWidth: 380, lineHeight: 1.6 }}>
        Taking you to AutoThresh Web so you can buy lifetime access. Already purchased? Sign in here.
      </div>
      <a
        href={PRODUCT_URL}
        onClick={() => { cancelled.current = true; }}
        style={{
          marginTop: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 22px',
          background: 'var(--accent)',
          color: '#000',
          textDecoration: 'none',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        Get AutoThresh Web
      </a>
      <button
        onClick={stayAndSignIn}
        style={{
          marginTop: 14,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}
      >
        I already bought — Sign in
      </button>
    </div>
  );
}
