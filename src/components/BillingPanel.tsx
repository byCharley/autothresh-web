import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useCountdown } from '../hooks/useCountdown';

interface Props {
  token?: string;
  planTitle?: string;
  nextBillingDate?: string;
  subscriptionStatus?: string;
  compact?: boolean;
  hideSummary?: boolean;
  onChanged?: () => void;
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function BillingPanel({ token, planTitle, nextBillingDate, subscriptionStatus, compact, hideSummary, onChanged }: Props) {
  const [confirm, setConfirm] = useState<'none' | 'cancel'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const status = (subscriptionStatus ?? '').toLowerCase();
  const hidden = status === 'creator' || status === 'tester' || status === 'lifetime' || status === 'blocked';
  const isTrial = status === 'trial' || status === 'app_trial';
  const trialCountdown = useCountdown(nextBillingDate, isTrial && !hidden);
  if (hidden || !token) return null;
  const authToken = token;

  const accessUntil = fmtDate(nextBillingDate);
  const isPaused = status === 'paused';
  const isCancelled = status === 'cancelled' || status === 'canceled';
  const canCancel = !isCancelled;
  // Subscriptions are being phased out — do not offer pause/resume (resume could re-enable charges).

  async function run(action: 'cancel') {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken },
        body: JSON.stringify({ action }),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) {
        setError(data.error || 'Something went wrong.');
        return;
      }
      setConfirm('none');
      setNote('This plan is cancelled. It will not renew or charge you.');
      onChanged?.();
    } catch {
      setError('Could not reach billing. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const mono: CSSProperties = { fontFamily: 'var(--font-mono)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10 }}>
      {!hideSummary && (
        <>
          <div style={{ fontSize: 9, ...mono, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            Billing
          </div>
          <div style={{ fontSize: 11, ...mono, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {planTitle || 'Subscription'}
            {isTrial && trialCountdown ? (
              <span style={{ color: '#a78bfa', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {` · ${trialCountdown === 'Ended' ? 'Trial ended' : `Ends in ${trialCountdown}`}`}
              </span>
            ) : accessUntil && !isPaused && !isCancelled ? (
              ` · Access through ${accessUntil} · will not renew`
            ) : ''}
            {isPaused ? ' · Paused' : ''}
            {isCancelled ? ' · Cancelled' : ''}
          </div>
        </>
      )}

      <div style={{ fontSize: 11, ...mono, color: 'var(--text)', lineHeight: 1.55, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        Subscriptions are ending. Your card will not be charged again
        {accessUntil && !isCancelled ? ` — access continues through ${accessUntil}` : ''}.
        After that you can buy Lifetime with credit for what you already paid (email autothreshweb@gmail.com).
      </div>

      {note && (
        <div style={{ fontSize: 11, ...mono, color: 'var(--text)', lineHeight: 1.5, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {note}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, ...mono, color: '#f87171', lineHeight: 1.5 }}>{error}</div>
      )}

      {confirm === 'cancel' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55 }}>
            End access now? Your plan already will not renew. Cancelling early ends access today — time already billed is not refunded.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={() => setConfirm('none')} style={ghostBtn}>Keep access</button>
            <button disabled={busy} onClick={() => run('cancel')} style={dangerBtn}>
              {busy ? 'Cancelling…' : 'End access now'}
            </button>
          </div>
        </div>
      )}

      {confirm === 'none' && canCancel && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button disabled={busy} onClick={() => { setError(''); setConfirm('cancel'); }} style={{ ...ghostBtn, color: 'var(--text-dim)' }}>
            End access early
          </button>
        </div>
      )}
    </div>
  );
}

const ghostBtn: CSSProperties = {
  height: 28, padding: '0 10px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer',
};
const dangerBtn: CSSProperties = {
  height: 28, padding: '0 10px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
  background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#f87171', cursor: 'pointer',
};
