import { useState } from 'react';
import { AppIcon } from './AppIcon';
import { EulaModal } from './EulaModal';
import { PageFooter } from './PageFooter';

const PRODUCT_URL = import.meta.env.VITE_SHOPIFY_PRODUCT_URL as string | undefined
  ?? 'https://charleypangus.com/collections/webapps';

interface Props {
  firstName?: string;
  onLogout: () => void;
  onSwitchAccount: () => Promise<void>;
}

export function SubscribePage({ firstName, onLogout, onSwitchAccount }: Props) {
  const [showEula, setShowEula] = useState(false);

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
      <div style={{ marginBottom: 36, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <AppIcon size={56} color="var(--accent)" />
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
          AutoThresh Web <span style={{ color: 'var(--accent)' }}>Beta 1.0.0</span>
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        width: 420, maxWidth: '90vw', padding: '28px 24px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>🔒</div>

        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          {firstName ? `Hi ${firstName} —` : ''} Subscription Required
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 24 }}>
          AutoThresh Web requires an active subscription.
          Subscribe to get full access to the tonal separation tool.
        </div>

        <a
          href={PRODUCT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ display: 'inline-flex', justifyContent: 'center', textDecoration: 'none', marginBottom: 12, minWidth: 200, color: '#000' }}
        >
          Subscribe Now
        </a>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            className="btn btn-ghost"
            onClick={onSwitchAccount}
            style={{ fontSize: 11, color: 'var(--text-dim)' }}
          >
            Switch Account
          </button>
          <button
            className="btn btn-ghost"
            onClick={onLogout}
            style={{ fontSize: 11, color: 'var(--text-dim)' }}
          >
            Sign out
          </button>
        </div>
      </div>

      <PageFooter onEula={() => setShowEula(true)} />
      {showEula && <EulaModal onClose={() => setShowEula(false)} />}
    </div>
  );
}
