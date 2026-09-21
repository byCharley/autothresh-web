/**
 * Phase out Seal Monthly/Annual auto-renewals.
 * Keeps access through the current paid period, then cancels so no further charges.
 */

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const CONCURRENCY  = 5;

export interface SunsetResult {
  id: number;
  email?: string;
  action: 'scheduled' | 'cancelled_now' | 'skipped' | 'failed';
  detail?: string;
}

export interface SunsetBatchOptions {
  /** active | paused */
  filter?: 'active' | 'paused';
  page?: number;
  perPage?: number;
}

export interface SunsetBatchResult {
  scanned: number;
  results: SunsetResult[];
  filter: 'active' | 'paused';
  page: number;
  hasMore: boolean;
  nextFilter: 'active' | 'paused' | null;
  nextPage: number | null;
  done: boolean;
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

async function skipNextBillingAttempt(subscriptionId: number, s: Record<string, unknown>): Promise<boolean> {
  const attempts = Array.isArray(s.billing_attempts) ? s.billing_attempts as Array<Record<string, unknown>> : [];
  const now = Date.now();
  const upcoming = attempts
    .map(a => ({ a, when: parseWhen(a.date) }))
    .filter(({ a, when }) => {
      const st = String(a.status ?? '').toLowerCase();
      if (st === 'completed' || st === 'success' || st === 'skipped' || a.completed_at) return false;
      return !!when && when.getTime() > now - 60_000;
    })
    .sort((x, y) => (x.when!.getTime() - y.when!.getTime()));

  const next = upcoming[0];
  if (!next) return false;
  const id = Number(next.a.id);
  if (!id) return false;

  const r = await fetch(`${SEAL_API_URL}/subscription-billing-attempt`, {
    method: 'PUT',
    headers: sealHeaders(),
    body: JSON.stringify({ id, subscription_id: subscriptionId, action: 'skip' }),
  });
  if (!r.ok) {
    console.error('[sunset] skip attempt failed', subscriptionId, id, r.status, await r.text().catch(() => ''));
    return false;
  }
  return true;
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

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
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

  if (alreadySunsetMarked(s)) {
    await skipNextBillingAttempt(id, s);
    return { id, email, action: 'scheduled', detail: 'already marked' };
  }

  const when = nextBillingDate(s);
  if (!when) {
    const ok = await cancelNow(id);
    return { id, email, action: ok ? 'cancelled_now' : 'failed', detail: 'no next billing date' };
  }

  // If renewal is imminent (under 2 hours), cancel now after skipping the next attempt.
  if (when.getTime() - Date.now() < 2 * 60 * 60 * 1000) {
    await skipNextBillingAttempt(id, s);
    const ok = await cancelNow(id);
    return { id, email, action: ok ? 'cancelled_now' : 'failed', detail: 'imminent renewal' };
  }

  // Skip next charge first, then schedule cancel — two Seal calls max per sub.
  await skipNextBillingAttempt(id, s);
  const scheduled = await scheduleCancellation(id, when);
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
    const subs = parseSealSubs(await r.json()).filter(isRecurringPlan);
    return mapPool(subs, CONCURRENCY, sunsetSubscription);
  } catch (e) {
    console.error('[sunset] email error', e);
    return [];
  }
}

/** Process one page of active or paused subscriptions (keeps under Vercel timeouts). */
export async function sunsetSubscriptionBatch(opts: SunsetBatchOptions = {}): Promise<SunsetBatchResult> {
  const filter = opts.filter ?? 'active';
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(50, Math.max(10, opts.perPage ?? 25));

  if (!SEAL_TOKEN) {
    return {
      scanned: 0, results: [], filter, page,
      hasMore: false, nextFilter: null, nextPage: null, done: true,
    };
  }

  const qs = filter === 'paused' ? 'paused-only=true' : 'active-only=true';
  const url = `${SEAL_API_URL}/subscriptions?${qs}&with-items=true&with-billing-attempts=true&page=${page}&per_page=${perPage}`;
  const r = await fetch(url, { headers: sealHeaders() });
  if (!r.ok) {
    console.error('[sunset] list failed', filter, page, r.status, await r.text().catch(() => ''));
    throw new Error(`Seal list failed (${r.status})`);
  }

  const subs = parseSealSubs(await r.json());
  const targets = subs.filter(isRecurringPlan);
  const results = await mapPool(targets, CONCURRENCY, sunsetSubscription);

  const pageFull = subs.length >= perPage;
  let nextFilter: 'active' | 'paused' | null = null;
  let nextPage: number | null = null;
  let hasMore = false;
  let done = true;

  if (pageFull) {
    hasMore = true;
    done = false;
    nextFilter = filter;
    nextPage = page + 1;
  } else if (filter === 'active') {
    hasMore = true;
    done = false;
    nextFilter = 'paused';
    nextPage = 1;
  }

  return {
    scanned: subs.length,
    results,
    filter,
    page,
    hasMore,
    nextFilter,
    nextPage,
    done,
  };
}

/** Batch sunset all active/paused Seal subscriptions (cron — page through until done). */
export async function sunsetAllRecurringSubscriptions(): Promise<{
  scanned: number;
  results: SunsetResult[];
}> {
  const results: SunsetResult[] = [];
  let scanned = 0;
  let filter: 'active' | 'paused' = 'active';
  let page = 1;

  // Hard cap pages so a stuck Seal API cannot run forever in one cron tick.
  for (let i = 0; i < 80; i++) {
    const batch = await sunsetSubscriptionBatch({ filter, page, perPage: 25 });
    scanned += batch.scanned;
    results.push(...batch.results);
    if (batch.done || !batch.nextFilter || !batch.nextPage) break;
    filter = batch.nextFilter;
    page = batch.nextPage;
  }

  return { scanned, results };
}
