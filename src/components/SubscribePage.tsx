import { useState, useCallback } from 'react';
import { AppIcon } from './AppIcon';
import { EulaModal } from './EulaModal';
import { FaqModal } from './FaqModal';
import { PageFooter } from './PageFooter';
import { BillingPanel } from './BillingPanel';
import { DeviceManager, type LicenseDevice } from './DeviceManager';

const LIFETIME_URL = 'https://charleypangus.com/products/autothresh-web';
const LIFETIME_MONTHLY_URL = 'https://charleypangus.com/discount/ATWEB30';
const LIFETIME_ANNUAL_URL  = 'https://charleypangus.com/discount/ATWEB50';

interface Props {
  firstName?: string;
  email?: string;
  subscriptionStatus?: string;
  planTitle?: string;
  subscriptionExpiresAt?: string;
  token?: string;
  devices?: LicenseDevice[];
  onLogout: () => void;
  onSwitchAccount?: () => void;
  onRecheck?: () => Promise<boolean>;
}

const PLAN_FEATURES = {
  lifetime: [
    'Everything in the app',
    'Pay once, own forever',
    'All future updates free',
    'Two devices per license',
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

function PricingModal({ onClose, offer }: { onClose: () => void; offer?: 'monthly30' | 'annual50' }) {
  const discounted = offer === 'annual50' ? { label: '50% off for annual members', price: '$75', url: LIFETIME_ANNUAL_URL }
    : offer === 'monthly30' ? { label: '30% off after your monthly plan', price: '$104', url: LIFETIME_MONTHLY_URL }
    : { label: 'Pay once. Own it forever.', price: '$149', url: LIFETIME_URL };
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
            color: '#fbbf24', marginBottom: 8,
          }}>Lifetime</div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            Pay once. Own it forever.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
            {discounted.label}
          </div>
        </div>

        <a href={discounted.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
          <div style={{ border: '1px solid #fbbf24', padding: '22px 20px', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, background: '#fbbf24', color: '#000', fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 8px' }}>ONE-TIME</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 34, fontWeight: 700, color: 'var(--text)' }}>{discounted.price}</span>
              {discounted.price !== '$149' && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-dim)', textDecoration: 'line-through' }}>$149</span>}
            </div>
            <PlanFeatures features={PLAN_FEATURES.lifetime} accent="#fbbf24" />
            <div style={{ marginTop: 20, textAlign: 'center', padding: '9px 0', background: '#fbbf24', color: '#000', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
              Buy Lifetime Access →
            </div>
          </div>
        </a>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
          Two devices per license. Remove a device anytime to free a slot.
        </div>
      </div>
    </div>
  );
}

export function SubscribePage({ firstName, email, subscriptionStatus, planTitle, subscriptionExpiresAt, token, devices, onLogout, onSwitchAccount, onRecheck }: Props) {
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
      height: '100%',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: 'var(--bg)',
      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
      backgroundSize: '28px 28px',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        flex: 1,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '32px 16px 16px',
        boxSizing: 'border-box',
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
        background: 'var(--surface)', border: `1px solid ${subscriptionStatus === 'blocked' ? 'rgba(248,113,113,0.35)' : 'var(--border)'}`,
        width: 380, maxWidth: '90vw', padding: '32px 28px', textAlign: 'center',
      }}>
        {subscriptionStatus === 'blocked' ? (
          /* ── Blocked state ── */
          <>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
            </div>

            <div style={{ fontSize: 15, fontWeight: 700, color: '#f87171', marginBottom: 6, letterSpacing: '-0.01em' }}>
              Account Restricted
            </div>

            {email && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                padding: '4px 10px', marginBottom: 16,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f87171', flexShrink: 0 }} />
                {email}
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 24 }}>
              It looks like you already have another account. We only allow one login per user — please sign in using your other account instead.
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {onSwitchAccount && (
                <button
                  className="btn btn-primary"
                  onClick={onSwitchAccount}
                  style={{ fontSize: 12, color: '#000' }}
                >
                  Sign in with different account
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
          </>
        ) : subscriptionStatus === 'device_limit' ? (
          <>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
                <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.01em' }}>
              Device limit reached
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 20 }}>
              This license is already active on 2 devices. Remove one below, then try this device again.
            </div>
            {token && (
              <div style={{ textAlign: 'left', marginBottom: 20 }}>
                <DeviceManager token={token} devices={devices} onActivated={onRecheck} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {onSwitchAccount && (
                <button className="btn btn-ghost" onClick={onSwitchAccount} style={{ fontSize: 11, color: 'var(--text-muted)' }}>Different account</button>
              )}
              <button className="btn btn-ghost" onClick={onLogout} style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sign out</button>
            </div>
          </>
        ) : subscriptionStatus === 'paused' ? (
          <>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.01em' }}>
              Subscription paused
            </div>
            {email && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                padding: '4px 10px', marginBottom: 16,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', flexShrink: 0 }} />
                {email}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 20 }}>
              Billing is on hold and this account does not have access right now. Resume whenever you are ready — you will not be charged while paused.
            </div>
            {token && (
              <div style={{ textAlign: 'left', marginBottom: 20 }}>
                <BillingPanel token={token} planTitle={planTitle} nextBillingDate={subscriptionExpiresAt} subscriptionStatus="paused" onChanged={() => { void onRecheck?.(); }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {onSwitchAccount && (
                <button className="btn btn-ghost" onClick={onSwitchAccount} style={{ fontSize: 11, color: 'var(--text-muted)' }}>Different account</button>
              )}
              <button className="btn btn-ghost" onClick={onLogout} style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sign out</button>
            </div>
          </>
        ) : (
          /* ── No subscription state ── */
          <>
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
              {firstName ? `Hi ${firstName} —` : ''} Lifetime license required
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
              {subscriptionStatus === 'cancelled' || subscriptionStatus === 'canceled'
                ? 'Your subscription has ended. Buy lifetime at 30% off to keep going — pay once, own forever.'
                : 'AutoThresh Web is a one-time purchase. Pay once and own it forever.'}
            </div>

            <button
              onClick={() => setShowPricing(true)}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 20, color: '#000', fontSize: 13 }}
            >
              {subscriptionStatus === 'cancelled' || subscriptionStatus === 'canceled' ? 'Buy Lifetime — 30% off' : 'Buy Lifetime — $149'}
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
          </>
        )}
      </div>
      </div>

      <PageFooter onEula={() => setShowEula(true)} onFaq={() => setShowFaq(true)} />
      {showEula    && <EulaModal onClose={() => setShowEula(false)} />}
      {showFaq     && <FaqModal  onClose={() => setShowFaq(false)} />}
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} offer={subscriptionStatus === 'cancelled' || subscriptionStatus === 'canceled' ? 'monthly30' : undefined} />}
    </div>
  );
}
