import { useState, useCallback } from 'react';
import { AppIcon } from './AppIcon';
import { EulaModal } from './EulaModal';
import { FaqModal } from './FaqModal';
import { PageFooter } from './PageFooter';

const MONTHLY_URL  = 'https://charleypangus.com/checkout/autothresh-web/monthly';
const ANNUAL_URL   = 'https://charleypangus.com/checkout/autothresh-web/yearly';
const LIFETIME_URL = 'https://charleypangus.com/checkout/autothresh-web/lifetime';

interface Props {
  firstName?: string;
  email?: string;
  onLogout: () => void;
  onSwitchAccount?: () => void;
  onRecheck?: () => Promise<boolean>;
}

const PLAN_FEATURES = {
  monthly: [
    'All 6 separation modes',
    'All export formats & mockups',
    'Unlimited presets & cloud sync',
    'Live chat support',
    'Tutorial library built-in',
  ],
  annual: [
    'Everything in Monthly',
    'Priority feature requests',
    'Early access to new modes',
    'Live chat support',
    'Tutorial library built-in',
  ],
  lifetime: [
    'Everything in Annual',
    'Pay once, own forever',
    'All future updates free',
    'No subscription fees ever',
    'Tutorial library built-in',
  ],
};

function PlanFeatures({ features, accent }: { features: string[]; accent: string }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {features.map(f => (
        <li key={f} style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.4 }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: accent, flexShrink: 0 }} />
          {f}
        </li>
      ))}
    </ul>
  );
}

function PricingModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        width: '100%', maxWidth: 800, padding: '28px 24px',
        position: 'relative',
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-dim)', fontSize: 18, lineHeight: 1, padding: 4,
          }}
        >✕</button>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--accent)', marginBottom: 8,
          }}>Choose a Plan</div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            Start your 3-day free trial
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
            Cancel anytime · No charge until trial ends
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>

          {/* Monthly */}
          <a href={MONTHLY_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'flex' }}>
            <div
              style={{ border: '1px solid var(--border)', padding: '22px 20px', width: '100%', cursor: 'pointer', transition: 'border-color 0.15s', display: 'flex', flexDirection: 'column' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Monthly</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 20 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1 }}>$8.99</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 }}>/mo</span>
              </div>
              <PlanFeatures features={PLAN_FEATURES.monthly} accent="var(--accent)" />
              <div style={{ marginTop: 20, textAlign: 'center', padding: '9px 0', border: '1px solid var(--accent)', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>
                Start Free Trial →
              </div>
            </div>
          </a>

          {/* Annual — featured */}
          <a href={ANNUAL_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'flex' }}>
            <div style={{ border: '1px solid var(--accent)', padding: '22px 20px', width: '100%', cursor: 'pointer', display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, right: 0, background: 'var(--accent)', color: '#000', fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 8px' }}>SAVE 15%</div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Annual</div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1 }}>$90.95</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 }}>/yr</span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', marginTop: 5, marginBottom: 14 }}>$7.58/mo · billed annually</div>
              </div>
              <PlanFeatures features={PLAN_FEATURES.annual} accent="var(--accent)" />
              <div style={{ marginTop: 20, textAlign: 'center', padding: '9px 0', background: 'var(--accent)', color: '#000', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>
                Start Free Trial →
              </div>
            </div>
          </a>

          {/* Lifetime */}
          <a href={LIFETIME_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'flex' }}>
            <div style={{ border: '1px solid #fbbf24', padding: '22px 20px', width: '100%', cursor: 'pointer', display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, right: 0, background: '#fbbf24', color: '#000', fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 8px' }}>ONE-TIME</div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Lifetime</div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1 }}>$249.99</span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 5 }}>one-time · never pay again</div>
              </div>
              <PlanFeatures features={PLAN_FEATURES.lifetime} accent="#fbbf24" />
              <div style={{ marginTop: 20, textAlign: 'center', padding: '9px 0', border: '1px solid #fbbf24', color: '#fbbf24', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>
                Buy Lifetime Access →
              </div>
            </div>
          </a>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
          Credit card required for trial · You won't be charged until it ends
        </div>
      </div>
    </div>
  );
}

export function SubscribePage({ firstName, email, onLogout, onSwitchAccount, onRecheck }: Props) {
  const [showEula,      setShowEula]      = useState(false);
  const [showFaq,       setShowFaq]       = useState(false);
  const [showPricing,   setShowPricing]   = useState(false);
  const [recheckState,  setRecheckState]  = useState<'idle' | 'checking' | 'denied'>('idle');

  const handleRecheck = useCallback(async () => {
    if (!onRecheck || recheckState === 'checking') return;
    setRecheckState('checking');
    const granted = await onRecheck();
    if (!granted) setRecheckState('denied');
  }, [onRecheck, recheckState]);

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
          AutoThresh Web <span style={{ color: 'var(--accent)' }}>Beta 1.0.2</span>
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        width: 380, maxWidth: '90vw', padding: '32px 28px', textAlign: 'center',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'rgba(255,107,26,0.12)', border: '1px solid rgba(255,107,26,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.01em' }}>
          {firstName ? `Hi ${firstName} —` : ''} Subscription Required
        </div>

        {email && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            padding: '4px 10px', marginBottom: 16,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            {email}
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 24 }}>
          Your subscription is no longer active. Pick a plan to get back in — monthly, annual, or lifetime.
        </div>

        <button
          onClick={() => setShowPricing(true)}
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 20, color: '#000', fontSize: 13 }}
        >
          View Plans & Subscribe
        </button>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {onSwitchAccount && (
            <button
              className="btn btn-ghost"
              onClick={onSwitchAccount}
              style={{ fontSize: 11, color: 'var(--text-muted)' }}
            >
              Different account
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={onLogout}
            style={{ fontSize: 11, color: 'var(--text-dim)' }}
          >
            Sign out
          </button>
        </div>

        {onRecheck && (
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={handleRecheck}
              disabled={recheckState === 'checking'}
              style={{
                background: 'none', border: 'none', cursor: recheckState === 'checking' ? 'default' : 'pointer',
                fontSize: 11, fontFamily: 'var(--font-mono)', color: recheckState === 'denied' ? '#ef4444' : 'var(--text-dim)',
                opacity: recheckState === 'checking' ? 0.5 : 1, padding: 0,
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { if (recheckState === 'idle') (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; }}
              onMouseLeave={(e) => { if (recheckState === 'idle') (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; }}
            >
              {recheckState === 'checking' && '↻ Checking…'}
              {recheckState === 'denied'   && 'No access found — contact support if this is an error'}
              {recheckState === 'idle'     && 'Already have access? Check again →'}
            </button>
          </div>
        )}
      </div>

      <PageFooter onEula={() => setShowEula(true)} onFaq={() => setShowFaq(true)} />
      {showEula    && <EulaModal onClose={() => setShowEula(false)} />}
      {showFaq     && <FaqModal  onClose={() => setShowFaq(false)} />}
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  );
}
