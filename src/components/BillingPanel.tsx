import { useState } from 'react';
import type { CSSProperties } from 'react';

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
  const [confirm, setConfirm] = useState<'none' | 'pause' | 'cancel'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const status = (subscriptionStatus ?? '').toLowerCase();
  const hidden = status === 'creator' || status === 'tester' || status === 'lifetime' || status === 'blocked';
  if (hidden || !token) return null;
  const authToken = token;

  const accessUntil = fmtDate(nextBillingDate);
  const isPaused = status === 'paused';
  const isCancelled = status === 'cancelled' || status === 'canceled';
  const canPause = !isPaused && !isCancelled;
  const canCancel = !isCancelled;

  async function run(action: 'pause' | 'resume' | 'cancel') {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken },
        body: JSON.stringify({ action }),
      });
      const data = await r.json() as { error?: string; cancelsOn?: string; immediate?: boolean };
      if (!r.ok) {
        setError(data.error || 'Something went wrong.');
        return;
      }
      setConfirm('none');
      if (action === 'cancel') {
        if (data.immediate || isPaused) {
          setNote('This plan is cancelled. It will not renew or charge you.');
        } else {
          setNote(accessUntil
            ? `Auto-renew is off. You keep full access through ${accessUntil}.`
            : 'Auto-renew is off. You keep access through the end of this period.');
        }
      } else if (action === 'pause') {
        setNote('Billing is paused. You can resume anytime from this account.');
      }
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
            {accessUntil && !isPaused && !isCancelled ? ` · ${status === 'trial' ? 'Trial ends' : 'Renews'} ${accessUntil}` : ''}
            {isPaused ? ' · Paused' : ''}
            {isCancelled ? ' · Cancelled' : ''}
          </div>
        </>
      )}

      {note && (
        <div style={{ fontSize: 11, ...mono, color: 'var(--text)', lineHeight: 1.5, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {note}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, ...mono, color: '#f87171', lineHeight: 1.5 }}>{error}</div>
      )}

      {confirm === 'pause' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55 }}>
            Pause stops access today and holds billing until you come back. Resume anytime from this screen.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={busy} onClick={() => setConfirm('none')} style={ghostBtn}>Keep plan</button>
            <button disabled={busy} onClick={() => run('pause')} style={warnBtn}>{busy ? 'Pausing…' : 'Pause now'}</button>
          </div>
        </div>
      )}

      {confirm === 'cancel' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55 }}>
            {isPaused
              ? 'This cancels the paused plan so it will not restart or charge you later. Time already billed is not refunded.'
              : <>
                  Time already billed is not refunded. Your plan will not renew, and you keep full access
                  {accessUntil ? ` through ${accessUntil}` : ' through the end of this billing period'}.
                  After that, this account will not open AutoThresh until you subscribe again.
                </>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={() => setConfirm('none')} style={ghostBtn}>Keep my plan</button>
            <button disabled={busy} onClick={() => run('cancel')} style={dangerBtn}>
              {busy ? 'Cancelling…' : isPaused ? 'Cancel plan' : 'Cancel at period end'}
            </button>
          </div>
        </div>
      )}

      {confirm === 'none' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {isPaused && (
            <button disabled={busy} onClick={() => run('resume')} style={primaryBtn}>
              {busy ? 'Resuming…' : 'Resume subscription'}
            </button>
          )}
          {canPause && (
            <button disabled={busy} onClick={() => { setError(''); setConfirm('pause'); }} style={ghostBtn}>
              Pause billing
            </button>
          )}
          {canCancel && (
            <button disabled={busy} onClick={() => { setError(''); setConfirm('cancel'); }} style={{ ...ghostBtn, color: 'var(--text-dim)' }}>
              Cancel subscription
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ghostBtn: CSSProperties = {
  height: 28, padding: '0 10px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer',
};
const warnBtn: CSSProperties = {
  height: 28, padding: '0 10px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
  background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24', cursor: 'pointer',
};
const dangerBtn: CSSProperties = {
  height: 28, padding: '0 10px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
  background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#f87171', cursor: 'pointer',
};
const primaryBtn: CSSProperties = {
  height: 30, padding: '0 10px', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
  background: 'var(--accent)', border: 'none', color: '#000', cursor: 'pointer',
};
