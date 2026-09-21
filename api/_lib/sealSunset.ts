/**
 * Cancel Seal Monthly/Annual immediately (stop all card charges).
 * Paid access through the current period is stored in plan_access and enforced in verify/auth.
 */

import { upsertPlanAccess } from './planAccess';

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const CONCURRENCY  = 4;

export interface SunsetResult {
  id: number;
  email?: string;
  action: 'cancelled_now' | 'skipped' | 'failed';
  detail?: string;
}

export interface SunsetBatchOptions {
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
  setupError?: string;
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
  return String(s.status ?? '').toUpperCase() === 'EXPIRED';
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
  const raw = String(value).trim();
  if (!raw) return null;
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** End of the current paid period (= when the next renewal would have charged). */
export function accessUntilDate(s: Record<string, unknown>): Date | null {
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
  if (candidates[0]) return candidates[0];

  // Fallback: keep at least the remainder of a typical cycle so we don't cut paid users off today.
  const t = sealPlanText(s);
  const annual = t.includes('year') || t.includes('annual') || t.includes('12 month');
  const days = annual ? 365 : 30;
  return new Date(Date.now() + days * 86_400_000);
}

function planTitleOf(s: Record<string, unknown>): string | undefined {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  const title = s.plan_title ?? s.product_title ?? s.plan_name ?? items[0]?.selling_plan_name ?? items[0]?.title;
  return title ? String(title) : undefined;
}

async function cancelNow(subscriptionId: number): Promise<boolean> {
  const r = await fetch(`${SEAL_API_URL}/subscription`, {
    method: 'PUT',
    headers: sealHeaders(),
    body: JSON.stringify({ id: subscriptionId, action: 'cancel' }),
  });
  if (!r.ok) {
    console.error('[cancel] Seal cancel failed', subscriptionId, r.status, await r.text().catch(() => ''));
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

/** Cancel one Seal subscription now; preserve paid access until period end. */
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
  if (st !== 'ACTIVE' && st !== 'TRIAL' && st !== 'PAUSED') {
    return { id, email, action: 'skipped', detail: `status ${st}` };
  }

  const until = accessUntilDate(s);
  if (email && until) {
    const saved = await upsertPlanAccess({
      email,
      accessUntil: until.toISOString(),
      planTitle: planTitleOf(s),
      sealSubscriptionId: id,
    });
    if (!saved.ok && saved.error?.includes('plan_access table missing')) {
      return { id, email, action: 'failed', detail: saved.error };
    }
  }

  const ok = await cancelNow(id);
  return {
    id,
    email,
    action: ok ? 'cancelled_now' : 'failed',
    detail: until ? `access through ${until.toISOString()}` : 'cancelled',
  };
}

export async function sunsetSubscriptionsForEmail(email: string): Promise<SunsetResult[]> {
  if (!SEAL_TOKEN || !email) return [];
  try {
    const r = await fetch(
      `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}&with-items=true&with-billing-attempts=true`,
      { headers: sealHeaders() },
    );
    if (!r.ok) return [];
    const subs = parseSealSubs(await r.json()).filter(isRecurringPlan);
    return mapPool(subs, CONCURRENCY, sunsetSubscription);
  } catch (e) {
    console.error('[cancel] email error', e);
    return [];
  }
}

export async function sunsetSubscriptionBatch(opts: SunsetBatchOptions = {}): Promise<SunsetBatchResult> {
  const filter = opts.filter ?? 'active';
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(50, Math.max(5, opts.perPage ?? 8));

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
    console.error('[cancel] list failed', filter, page, r.status, await r.text().catch(() => ''));
    throw new Error(`Seal list failed (${r.status})`);
  }

  const subs = parseSealSubs(await r.json());
  const targets = subs.filter(isRecurringPlan);
  const results = await mapPool(targets, CONCURRENCY, sunsetSubscription);

  const setupError = results.find(x => x.detail?.includes('plan_access table missing'))?.detail;

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
    setupError,
  };
}

export async function sunsetAllRecurringSubscriptions(): Promise<{
  scanned: number;
  results: SunsetResult[];
}> {
  const results: SunsetResult[] = [];
  let scanned = 0;
  let filter: 'active' | 'paused' = 'active';
  let page = 1;

  for (let i = 0; i < 80; i++) {
    const batch = await sunsetSubscriptionBatch({ filter, page, perPage: 8 });
    scanned += batch.scanned;
    results.push(...batch.results);
    if (batch.setupError) break;
    if (batch.done || !batch.nextFilter || !batch.nextPage) break;
    filter = batch.nextFilter;
    page = Math.max(1, batch.nextPage);
    if (i >= 12) break;
  }

  return { scanned, results };
}
