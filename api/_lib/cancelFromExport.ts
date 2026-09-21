/**
 * Cancel subscriptions from a Seal CSV export.
 * Uses exact ids + next_billing_date so we stop charges and keep paid access.
 */

import { upsertPlanAccess } from './planAccess';
import { ACTIVE_SUBSCRIPTION_EXPORT } from '../_data/activeSubscriptions';

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

export interface ExportRow {
  id: number;
  email: string;
  nextBillingDate: string;
  planTitle: string;
  status: string;
  interval: string;
}

export interface ExportCancelResult {
  id: number;
  email: string;
  action: 'cancelled_now' | 'skipped' | 'failed';
  detail?: string;
}

function sealHeaders() {
  return { 'Content-Type': 'application/json', 'X-Seal-Token': SEAL_TOKEN };
}

export function loadActiveSubscriptionExport(): ExportRow[] {
  return ACTIVE_SUBSCRIPTION_EXPORT.map(r => ({ ...r }));
}

async function cancelNow(subscriptionId: number): Promise<{ ok: boolean; detail?: string }> {
  const r = await fetch(`${SEAL_API_URL}/subscription`, {
    method: 'PUT',
    headers: sealHeaders(),
    body: JSON.stringify({ id: subscriptionId, action: 'cancel' }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('[export-cancel] Seal cancel failed', subscriptionId, r.status, detail.slice(0, 200));
    return { ok: false, detail: `Seal ${r.status}` };
  }
  return { ok: true };
}

export async function cancelExportBatch(opts: {
  offset?: number;
  limit?: number;
}): Promise<{
  total: number;
  offset: number;
  limit: number;
  processed: number;
  done: boolean;
  nextOffset: number | null;
  results: ExportCancelResult[];
  setupError?: string;
}> {
  if (!SEAL_TOKEN) {
    return {
      total: 0, offset: 0, limit: 0, processed: 0, done: true, nextOffset: null, results: [],
      setupError: 'Missing SEAL_API_TOKEN',
    };
  }

  const all = loadActiveSubscriptionExport();
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(20, Math.max(1, opts.limit ?? 8));
  const slice = all.slice(offset, offset + limit);
  const results: ExportCancelResult[] = [];

  for (const row of slice) {
    if (row.status && row.status !== 'ACTIVE' && row.status !== 'PAUSED' && row.status !== 'TRIAL') {
      results.push({ id: row.id, email: row.email, action: 'skipped', detail: `status ${row.status}` });
      continue;
    }

    const until = new Date(row.nextBillingDate);
    if (Number.isNaN(until.getTime())) {
      results.push({ id: row.id, email: row.email, action: 'failed', detail: 'bad next_billing_date' });
      continue;
    }

    const saved = await upsertPlanAccess({
      email: row.email,
      accessUntil: until.toISOString(),
      planTitle: row.planTitle,
      sealSubscriptionId: row.id,
    });
    if (!saved.ok && saved.error?.includes('plan_access table missing')) {
      return {
        total: all.length,
        offset,
        limit,
        processed: results.length,
        done: false,
        nextOffset: offset,
        results,
        setupError: saved.error,
      };
    }

    const cancelled = await cancelNow(row.id);
    results.push({
      id: row.id,
      email: row.email,
      action: cancelled.ok ? 'cancelled_now' : 'failed',
      detail: cancelled.ok
        ? `access through ${until.toISOString()}`
        : (cancelled.detail || 'cancel failed'),
    });
  }

  const nextOffset = offset + slice.length;
  const done = nextOffset >= all.length;
  return {
    total: all.length,
    offset,
    limit,
    processed: results.length,
    done,
    nextOffset: done ? null : nextOffset,
    results,
  };
}
