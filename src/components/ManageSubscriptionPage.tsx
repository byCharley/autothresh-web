import { useState } from 'react';
import { AppIcon } from './AppIcon';
import { BillingPanel } from './BillingPanel';
import { ContactModal } from './ContactModal';
import { EulaModal } from './EulaModal';
import { FaqModal } from './FaqModal';
import { PageFooter } from './PageFooter';
import { useAppVersion } from '../hooks/useAppVersion';

interface Props {
  onBack: () => void;
  token?: string;
  planTitle?: string;
  nextBillingDate?: string;
  subscriptionStatus?: string;
  onChanged?: () => void;
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function statusMeta(status: string) {
  if (status === 'trial') return { label: 'Free Trial', color: '#a78bfa' };
  if (status === 'paused') return { label: 'Paused', color: '#fbbf24' };
  if (status === 'cancelled' || status === 'canceled') return { label: 'Cancelled', color: '#e6a817' };
  return { label: 'Active', color: '#3ecf4f' };
}

export function ManageSubscriptionPage({ onBack, token, planTitle, nextBillingDate, subscriptionStatus, onChanged }: Props) {
  const appVersion = useAppVersion();
  const [showEula, setShowEula] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [showContact, setShowContact] = useState(false);

  const status = (subscriptionStatus ?? '').toLowerCase();
  const until = fmtDate(nextBillingDate);
  const meta = statusMeta(status);
  const dateLine = until && status !== 'paused' && status !== 'cancelled' && status !== 'canceled'
    ? `${status === 'trial' ? 'Trial ends' : 'Renews'} ${until}`
    : status === 'paused'
      ? 'Billing is on hold — resume anytime'
      : status === 'cancelled' || status === 'canceled'
        ? until ? `Access through ${until}` : 'This plan will not renew'
        : null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 8000,
      background: 'var(--bg)',
      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
      backgroundSize: '28px 28px',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-sans)',
      paddingTop: 'env(safe-area-inset-top, 0px)',
    }}>
      <div style={{
        height: 52, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <button
          onClick={onBack}
          style={{
            height: 30, padding: '0 10px',
            fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back to editor
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <AppIcon size={18} color="var(--accent)" />
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>
            AutoThresh Web <span style={{ color: 'var(--accent)' }}>Beta {appVersion}</span>
          </div>
        </div>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '36px 16px 20px',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
            width: 420, height: 180, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 50% 0%, var(--accent-dim) 0%, transparent 70%)',
          }} />

          <div style={{ marginBottom: 28, textAlign: 'center', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, marginBottom: 16 }}>
              <AppIcon size={52} color="var(--accent)" />
              <span style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.18)', display: 'block', flexShrink: 0 }} />
              <img
                src="/CharleyPangus_Favicon.svg"
                alt="Charley Pangus"
                style={{ height: 42, width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.9 }}
              />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
              AutoThresh™ Web <span style={{ color: 'var(--accent)' }}>Beta {appVersion}</span>
            </div>
            <div style={{
              fontSize: 10, color: 'var(--text-muted)', marginTop: 8,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              fontFamily: 'var(--font-mono)',
            }}>
              Manage subscription
            </div>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            width: '100%', maxWidth: 420,
            position: 'relative',
            boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
          }}>
            <div style={{ height: 3, background: 'var(--accent)' }} />
            <div style={{ padding: '26px 24px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)',
                }}>
                  Current plan
                </div>
                <span style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: '#111',
                  background: meta.color, padding: '3px 8px',
                }}>
                  {meta.label}
                </span>
              </div>

              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', marginBottom: 6 }}>
                {planTitle || 'Subscription'}
              </div>
              {dateLine && (
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 22 }}>
                  {dateLine}
                </div>
              )}

              <div style={{ height: 1, background: 'var(--border)', margin: dateLine ? '0 0 20px' : '16px 0 20px' }} />

              {token ? (
                <BillingPanel
                  token={token}
                  planTitle={planTitle}
                  nextBillingDate={nextBillingDate}
                  subscriptionStatus={subscriptionStatus}
                  hideSummary
                  onChanged={onChanged}
                />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Sign in again to manage billing.</div>
              )}
            </div>
          </div>
        </div>

        <PageFooter
          onEula={() => setShowEula(true)}
          onFaq={() => setShowFaq(true)}
          onContact={() => setShowContact(true)}
        />
      </div>

      {showEula && <EulaModal onClose={() => setShowEula(false)} />}
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
    </div>
  );
}
