import { useState } from 'react';

const STORAGE_KEY = 'at_lifetime_migration_dismissed';
const CONTACT_EMAIL = 'autothreshweb@gmail.com';

function planLooksRecurring(planTitle?: string): boolean {
  const t = (planTitle ?? '').toLowerCase();
  if (!t.trim()) return false;
  const annual =
    t.includes('year') ||
    t.includes('annual') ||
    t.includes('12 month') ||
    t.includes('12-month');
  const monthly = (t.includes('month') || t.includes('monthly')) && !annual;
  return monthly || annual;
}

/** Monthly / Annual subscribers (active, paused, or trial) and creator admins. */
export function isLifetimeMigrationAudience(
  subscriptionStatus?: string,
  planTitle?: string,
): boolean {
  const status = (subscriptionStatus ?? '').toLowerCase();
  if (status === 'creator') return true;
  if (status !== 'active' && status !== 'paused' && status !== 'trial' && status !== 'paid_through') return false;
  return planLooksRecurring(planTitle) || status === 'paid_through';
}

export function shouldShowLifetimeMigration(
  subscriptionStatus?: string,
  planTitle?: string,
): boolean {
  if (!isLifetimeMigrationAudience(subscriptionStatus, planTitle)) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'true';
  } catch {
    return true;
  }
}

function markLifetimeMigrationSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    /* ignore */
  }
}

interface Props {
  onClose: () => void;
  planTitle?: string;
  accessThrough?: string;
  onActivateLicense?: (licenseKey: string, orderNumber: string) => Promise<{ ok: boolean; error?: string }>;
}

function fmtAccess(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function LifetimeMigrationModal({ onClose, planTitle, accessThrough, onActivateLicense }: Props) {
  const [neverShow, setNeverShow] = useState(true);
  const [licenseKey, setLicenseKey] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const until = fmtAccess(accessThrough);

  const handleClose = () => {
    if (neverShow) markLifetimeMigrationSeen();
    onClose();
  };

  const mailHref =
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent('Lifetime upgrade — subscription credit')}` +
    `&body=${encodeURIComponent(
      "Hi Charley,\n\nI'd like to switch from my subscription to Lifetime. Please send me a special discount code and credit what I've already paid toward Lifetime membership.\n\nMy plan: " +
        (planTitle || 'Monthly / Annual') +
        '\n\nThanks!',
    )}`;

  const canActivate = !!onActivateLicense && !!licenseKey.trim() && !!orderNumber.trim() && !busy;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        maxWidth: 480, width: '100%',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              background: '#fbbf24', color: '#111',
              padding: '2px 6px',
            }}>
              Important
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)',
            }}>
              Switching to Lifetime
            </span>
          </div>
          <button
            onClick={handleClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, lineHeight: 1 }}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div style={{ padding: '22px 24px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8, fontFamily: 'var(--font-sans)' }}>
          <p style={{ margin: '0 0 14px', color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>
            We’re ending Monthly and Annual subscriptions and moving to a pay-once, own-for-life model.
          </p>
          <p style={{ margin: '0 0 14px' }}>
            Your card will <span style={{ color: 'var(--text)', fontWeight: 600 }}>not be charged again</span>.
            {until
              ? <> You keep full access through <span style={{ color: 'var(--text)', fontWeight: 600 }}>{until}</span> — the end of the period you already paid for.</>
              : <> You keep access through the end of the period you already paid for.</>}
            {' '}Subscriptions are cancelled; nothing auto-renews.
          </p>
          <p style={{ margin: '0 0 14px' }}>
            When you buy Lifetime, activate your license key below to convert this account — then Sign in with your email on any device (up to 3).
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>
            Need a discount that credits what you already paid? Email me with the address on your account.
          </p>

          {onActivateLicense && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--text-muted)', marginBottom: 10,
              }}>
                Activate lifetime license
              </div>
              <input
                className="login-input"
                value={licenseKey}
                onChange={e => setLicenseKey(e.target.value)}
                placeholder="License key"
                style={{ width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
              />
              <input
                className="login-input"
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                placeholder="Order number"
                style={{ width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canActivate}
                onClick={async () => {
                  if (!canActivate) return;
                  setBusy(true);
                  setError('');
                  const result = await onActivateLicense(licenseKey.trim(), orderNumber.trim());
                  setBusy(false);
                  if (!result.ok) {
                    setError(result.error || 'Could not activate that license.');
                    return;
                  }
                  markLifetimeMigrationSeen();
                  onClose();
                }}
                style={{ width: '100%', justifyContent: 'center', color: '#000', opacity: canActivate ? 1 : 0.55 }}
              >
                {busy ? 'Activating…' : 'Convert to Lifetime'}
              </button>
              {error && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)', lineHeight: 1.45 }}>{error}</div>
              )}
            </div>
          )}
        </div>

        <div style={{
          padding: '14px 24px 18px', borderTop: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
              userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={neverShow}
                onChange={(e) => setNeverShow(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
              />
              Don&apos;t show again
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                onClick={handleClose}
                style={{ minWidth: 90 }}
              >
                Got It
              </button>
              <a
                href={mailHref}
                className="btn btn-primary"
                onClick={handleClose}
                style={{
                  color: '#000', minWidth: 120, textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                Email Charley
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
