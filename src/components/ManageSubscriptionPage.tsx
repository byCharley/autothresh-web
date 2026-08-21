import { BillingPanel } from './BillingPanel';

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

export function ManageSubscriptionPage({ onBack, token, planTitle, nextBillingDate, subscriptionStatus, onChanged }: Props) {
  const status = (subscriptionStatus ?? '').toLowerCase();
  const until = fmtDate(nextBillingDate);
  const statusLabel = status === 'trial' ? 'Free trial' : status === 'paused' ? 'Paused' : status === 'cancelled' ? 'Cancelled' : 'Active';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 8000,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0px)',
    }}>
      <div style={{
        height: 52, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
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
        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>
          Manage subscription
        </div>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        display: 'flex', justifyContent: 'center',
        padding: '28px 16px calc(32px + env(safe-area-inset-bottom, 0px))',
      }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            padding: '22px 20px',
          }}>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>
              Current plan
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.02em' }}>
              {planTitle || 'Subscription'}
            </div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 22 }}>
              {statusLabel}
              {until && status !== 'paused' && status !== 'cancelled' ? ` · ${status === 'trial' ? 'Trial ends' : 'Renews'} ${until}` : ''}
            </div>

            {token ? (
              <BillingPanel
                token={token}
                planTitle={planTitle}
                nextBillingDate={nextBillingDate}
                subscriptionStatus={subscriptionStatus}
                onChanged={onChanged}
              />
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Sign in again to manage billing.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
