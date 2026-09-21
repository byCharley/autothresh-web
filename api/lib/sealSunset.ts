/**
 * Phase out Seal Monthly/Annual auto-renewals.
 * Keeps access through the current paid period, then cancels so no further charges.
 */

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

export interface SunsetResult {
  id: number;
  email?: string;
  action: 'scheduled' | 'cancelled_now' | 'skipped' | 'failed';
  detail?: string;
}

function sealHeaders() {
  return { 'Content-Type': 'application/json', 'X-Seal-Token': SEAL_TOKEN };
}

export function parseSealSubs(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (payload && Array.isArray(payload.subscriptions)) {
      return payload.subscriptions as Array<Record<string, unknown>>;
    }
    for (const key of ['subscriptions', 'data', 'result', 'subscription_contracts']) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

export function sealPlanText(s: Record<string, unknown>): string {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  return [
    s.billing_interval, s.interval, s.delivery_interval,
    s.plan_title, s.product_title, s.plan_name, s.selling_plan_name, s.name,
    ...items.map(i => [i.selling_plan_name, i.title, i.product_title, i.name].filter(Boolean).join(' ')),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function isLifetimeOrOneTime(s: Record<string, unknown>): boolean {
  const t = sealPlanText(s);
  if (/one[\s_-]*time/.test(t) || /\blifetime\b/.test(t)) return true;
  if (Number(s.subscription_type) === 3) return true;
  const st = String(s.status ?? '').toUpperCase();
  return st === 'EXPIRED';
}

export function isRecurringPlan(s: Record<string, unknown>): boolean {
  if (isLifetimeOrOneTime(s)) return false;
  const t = sealPlanText(s);
  const annual = t.includes('year') || t.includes('annual') || t.includes('12 month') || t.includes('12-month');
  const monthly = (t.includes('month') || t.includes('monthly')) && !annual;
  if (monthly || annual) return true;
  const interval = String(
    s.billing_interval_type ?? s.interval_type ?? s.billing_interval ?? s.interval ?? '',
  ).toLowerCase();
  return interval.includes('month') || interval.includes('year') || interval.includes('week');
}

function parseWhen(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const d = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function nextBillingDate(s: Record<string, unknown>): Date | null {
  const attempts = Array.isArray(s.billing_attempts) ? s.billing_attempts as Array<Record<string, unknown>> : [];
  const now = Date.now();
  const upcoming = attempts
    .filter(a => {
      const st = String(a.status ?? '').toLowerCase();
      return st !== 'completed' && st !== 'success' && st !== 'skipped' && !a.completed_at;
    })
    .map(a => parseWhen(a.date))
    .filter((d): d is Date => !!d && d.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime());

  const candidates = [
    upcoming[0] ?? null,
    parseWhen(s.next_billing_date),
    parseWhen(s.next_charge_scheduled_at),
    parseWhen(s.next_charge_at),
    parseWhen(s.trial_end_date ?? s.trial_ends_on ?? s.free_trial_end_date ?? s.trial_end),
  ].filter((d): d is Date => !!d && d.getTime() > now - 60_000);

  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0] ?? null;
}

function alreadySunsetMarked(s: Record<string, unknown>): boolean {
  const note = String(s.note ?? '').toLowerCase();
  if (note.includes('autothresh-sunset') || note.includes('no renew') || note.includes('lifetime migration')) {
    return true;
  }
  const logs = Array.isArray(s.log) ? s.log as Array<Record<string, unknown>> : [];
  return logs.some(l => {
    const c = String(l.content ?? '').toLowerCase();
    return c.includes('schedul') && c.includes('cancel');
  });
}

async function skipFutureBillingAttempts(subscriptionId: number, s: Record<string, unknown>): Promise<number> {
  const attempts = Array.isArray(s.billing_attempts) ? s.billing_attempts as Array<Record<string, unknown>> : [];
  const now = Date.now();
  let skipped = 0;
  for (const a of attempts) {
    const id = Number(a.id);
    if (!id) continue;
    const st = String(a.status ?? '').toLowerCase();
    if (st === 'completed' || st === 'success' || st === 'skipped' || a.completed_at) continue;
    const when = parseWhen(a.date);
    if (when && when.getTime() < now - 60_000) continue;
    const r = await fetch(`${SEAL_API_URL}/subscription-billing-attempt`, {
      method: 'PUT',
      headers: sealHeaders(),
      body: JSON.stringify({ id, subscription_id: subscriptionId, action: 'skip' }),
    });
    if (r.ok) skipped++;
    else console.error('[sunset] skip attempt failed', subscriptionId, id, r.status, await r.text().catch(() => ''));
  }
  return skipped;
}

async function scheduleCancellation(subscriptionId: number, when: Date): Promise<boolean> {
  // Cancel one hour before the scheduled charge so Seal does not bill first.
  const cancelAt = new Date(Math.max(Date.now() + 60_000, when.getTime() - 60 * 60 * 1000));
  const yyyy = cancelAt.getUTCFullYear();
  const mm = String(cancelAt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(cancelAt.getUTCDate()).padStart(2, '0');
  const hh = String(cancelAt.getUTCHours()).padStart(2, '0');
  const mi = String(cancelAt.getUTCMinutes()).padStart(2, '0');

  const r = await fetch(`${SEAL_API_URL}/subscription-schedule-cancellation`, {
    method: 'PUT',
    headers: sealHeaders(),
    body: JSON.stringify({
      id: subscriptionId,
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hh}:${mi}`,
      timezone: '+00:00',
    }),
  });
  if (!r.ok) {
    console.error('[sunset] schedule cancel failed', subscriptionId, r.status, await r.text().catch(() => ''));
    return false;
  }
  return true;
}

async function cancelNow(subscriptionId: number): Promise<boolean> {
  const r = await fetch(`${SEAL_API_URL}/subscription`, {
    method: 'PUT',
    headers: sealHeaders(),
    body: JSON.stringify({ id: subscriptionId, action: 'cancel' }),
  });
  if (!r.ok) {
    console.error('[sunset] cancel now failed', subscriptionId, r.status, await r.text().catch(() => ''));
    return false;
  }
  return true;
}

async function tagSunsetNote(subscriptionId: number, existingNote: unknown): Promise<void> {
  const prev = String(existingNote ?? '').trim();
  if (prev.toLowerCase().includes('autothresh-sunset')) return;
  const note = prev
    ? `${prev}\n[autothresh-sunset] No further renewals — cancel at period end.`
    : '[autothresh-sunset] No further renewals — cancel at period end.';
  try {
    await fetch(`${SEAL_API_URL}/subscription`, {
      method: 'PUT',
      headers: sealHeaders(),
      body: JSON.stringify({ id: subscriptionId, action: 'edit', note }),
    });
  } catch {
    /* note is best-effort */
  }
}

/** Stop renewals for one Seal subscription. Keeps access until period end when possible. */
export async function sunsetSubscription(s: Record<string, unknown>): Promise<SunsetResult> {
  const id = Number(s.id);
  const email = String(s.email ?? '').toLowerCase() || undefined;
  if (!id) return { id: 0, email, action: 'failed', detail: 'missing id' };
  if (!SEAL_TOKEN) return { id, email, action: 'failed', detail: 'no Seal token' };
  if (!isRecurringPlan(s)) return { id, email, action: 'skipped', detail: 'not recurring' };

  const st = String(s.status ?? '').toUpperCase();
  if (st === 'CANCELLED' || st === 'CANCELED' || st === 'EXPIRED') {
    return { id, email, action: 'skipped', detail: 'already ended' };
  }

  // Paused plans: cancel immediately so resume cannot trigger a charge.
  if (st === 'PAUSED') {
    const ok = await cancelNow(id);
    return { id, email, action: ok ? 'cancelled_now' : 'failed', detail: 'paused' };
  }

  if (st !== 'ACTIVE' && st !== 'TRIAL') {
    return { id, email, action: 'skipped', detail: `status ${st}` };
  }

  await skipFutureBillingAttempts(id, s);

  const when = nextBillingDate(s);
  if (!when) {
    const ok = await cancelNow(id);
    return { id, email, action: ok ? 'cancelled_now' : 'failed', detail: 'no next billing date' };
  }

  // If renewal is imminent (under 2 hours), cancel now after skipping attempts.
  if (when.getTime() - Date.now() < 2 * 60 * 60 * 1000) {
    const ok = await cancelNow(id);
    return { id, email, action: ok ? 'cancelled_now' : 'failed', detail: 'imminent renewal' };
  }

  if (alreadySunsetMarked(s)) {
    return { id, email, action: 'scheduled', detail: 'already marked' };
  }

  const scheduled = await scheduleCancellation(id, when);
  if (scheduled) await tagSunsetNote(id, s.note);
  return {
    id,
    email,
    action: scheduled ? 'scheduled' : 'failed',
    detail: `cancel ~${when.toISOString()}`,
  };
}

/** Sunset every matching subscription for an email (login safety net). */
export async function sunsetSubscriptionsForEmail(email: string): Promise<SunsetResult[]> {
  if (!SEAL_TOKEN || !email) return [];
  try {
    const r = await fetch(
      `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}&with-items=true&with-billing-attempts=true`,
      { headers: sealHeaders() },
    );
    if (!r.ok) {
      console.error('[sunset] list by email failed', r.status, await r.text().catch(() => ''));
      return [];
    }
    const subs = parseSealSubs(await r.json());
    const results: SunsetResult[] = [];
    for (const s of subs) {
      if (!isRecurringPlan(s)) continue;
      results.push(await sunsetSubscription(s));
    }
    return results;
  } catch (e) {
    console.error('[sunset] email error', e);
    return [];
  }
}

/** Batch sunset all active/paused Seal subscriptions (cron). */
export async function sunsetAllRecurringSubscriptions(): Promise<{
  scanned: number;
  results: SunsetResult[];
}> {
  if (!SEAL_TOKEN) return { scanned: 0, results: [] };
  const results: SunsetResult[] = [];
  let scanned = 0;

  for (const filter of ['active-only=true', 'paused-only=true'] as const) {
    for (let page = 1; page <= 40; page++) {
      const url = `${SEAL_API_URL}/subscriptions?${filter}&with-items=true&with-billing-attempts=true&page=${page}&per_page=50`;
      const r = await fetch(url, { headers: sealHeaders() });
      if (!r.ok) {
        console.error('[sunset] list failed', filter, page, r.status);
        break;
      }
      const subs = parseSealSubs(await r.json());
      if (!subs.length) break;
      for (const s of subs) {
        scanned++;
        if (!isRecurringPlan(s)) continue;
        results.push(await sunsetSubscription(s));
      }
      if (subs.length < 50) break;
    }
  }

  return { scanned, results };
}
