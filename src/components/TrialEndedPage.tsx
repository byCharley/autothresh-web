import { useEffect, useState } from 'react';
import { AppIcon } from './AppIcon';
import { getDeviceId } from '../lib/deviceId';
import { getBrowserFingerprint } from '../lib/fingerprint';
import { PRODUCT_URL, PRODUCT_PRICE, productUrlWithCode } from '../lib/product';

interface Props {
  onSignIn: () => void;
}

export function TrialEndedPage({ onSignIn }: Props) {
  const [code, setCode] = useState('');
  const [price, setPrice] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fingerprint = await getBrowserFingerprint();
      const r = await fetch('/api/discount', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: getDeviceId(), fingerprint }),
      });
      const data = await r.json() as { code?: string; price?: string };
      if (cancelled || !r.ok || !data.code) return;
      setCode(data.code);
      if (data.price) setPrice(data.price);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const buyUrl = productUrlWithCode(code);
  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
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
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
        Buy a license at 15% off{price ? ` (${price})` : ''}. Want to save more? There are bundle deals on the{' '}
        <a href={PRODUCT_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
          product page
        </a>
        {' '}at checkout.
      </div>

      {code && (
        <div style={{
          marginTop: 22, width: '100%', maxWidth: 400,
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          padding: '10px 12px',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 4 }}>
              Your one-time code
            </div>
            <div style={{ fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.04em' }}>
              {code}
            </div>
          </div>
          <button
            onClick={copyCode}
            style={{
              flexShrink: 0, height: 32, padding: '0 12px',
              fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
              background: 'transparent', border: '1px solid var(--border)',
              color: copied ? '#4ade80' : 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {code && (
        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.6, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textAlign: 'center', maxWidth: 400 }}>
          This code is for AutoThresh Web only and cannot be stacked with bundles or other discounts.
        </div>
      )}

      <a
        href={buyUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          marginTop: 24,
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
        {code ? 'Buy license — 15% off' : `Get AutoThresh Web — ${PRODUCT_PRICE}`}
      </a>
      <button
        onClick={onSignIn}
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
