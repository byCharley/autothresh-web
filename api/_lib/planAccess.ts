/**
 * Paid-period access after we cancel Seal subscriptions.
 * Users keep the app until access_until; cards are not charged again.
 *
 * Prefer Supabase plan_access rows. If missing (table empty / never seeded),
 * fall back to the bundled Seal export so cancelled Monthly/Annual users keep
 * access through their next_billing_date.
 */

import { ACTIVE_SUBSCRIPTION_EXPORT } from '../_data/activeSubscriptions';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export interface PlanAccessRow {
  email: string;
  accessUntil: string;
  planTitle?: string;
}

const EXPORT_BY_EMAIL = new Map(
  ACTIVE_SUBSCRIPTION_EXPORT.map(r => [
    r.email.trim().toLowerCase(),
    r,
  ] as const),
);

function sbHeaders(prefer?: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function stillValid(iso: string): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > Date.now();
}

function fromExport(email: string): PlanAccessRow | null {
  const row = EXPORT_BY_EMAIL.get(email.trim().toLowerCase());
  if (!row || !stillValid(row.nextBillingDate)) return null;
  return {
    email: row.email.trim().toLowerCase(),
    accessUntil: new Date(row.nextBillingDate).toISOString(),
    planTitle: row.planTitle,
  };
}

export async function upsertPlanAccess(opts: {
  email: string;
  accessUntil: string;
  planTitle?: string;
  sealSubscriptionId?: number;
}): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: 'no supabase' };
  const email = opts.email.trim().toLowerCase();
  if (!email || !opts.accessUntil) return { ok: false, error: 'missing email/accessUntil' };

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/plan_access?on_conflict=email`,
    {
      method: 'POST',
      headers: sbHeaders('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify({
        email,
        access_until: opts.accessUntil,
        plan_title: opts.planTitle ?? null,
        seal_subscription_id: opts.sealSubscriptionId ?? null,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error('[plan_access] upsert failed', r.status, body.slice(0, 300));
    if (r.status === 404 || body.includes('does not exist') || body.includes('Could not find')) {
      return {
        ok: false,
        error:
          'plan_access table missing — run in Supabase SQL:\n\n' +
          'CREATE TABLE plan_access (\n' +
          '  email text PRIMARY KEY,\n' +
          '  access_until timestamptz NOT NULL,\n' +
          '  plan_title text,\n' +
          '  seal_subscription_id bigint,\n' +
          '  updated_at timestamptz NOT NULL DEFAULT now()\n' +
          ');',
      };
    }
    return { ok: false, error: `Supabase ${r.status}` };
  }
  return { ok: true };
}

export async function getPlanAccess(email: string): Promise<PlanAccessRow | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/plan_access?email=eq.${encodeURIComponent(normalized)}&select=email,access_until,plan_title&limit=1`,
        { headers: sbHeaders() },
      );
      if (r.ok) {
        const rows = await r.json() as Array<{ email: string; access_until: string; plan_title?: string }>;
        if (rows.length && stillValid(rows[0].access_until)) {
          return {
            email: rows[0].email,
            accessUntil: rows[0].access_until,
            planTitle: rows[0].plan_title || undefined,
          };
        }
      }
    } catch {
      /* fall through to export */
    }
  }

  const exported = fromExport(normalized);
  if (!exported) return null;

  // Self-heal: write the export date into Supabase when the row is missing.
  const exportRow = EXPORT_BY_EMAIL.get(normalized);
  void upsertPlanAccess({
    email: exported.email,
    accessUntil: exported.accessUntil,
    planTitle: exported.planTitle,
    sealSubscriptionId: exportRow?.id,
  });

  return exported;
}

export async function countPlanAccess(): Promise<{ dbRows: number | null; exportRows: number; tableMissing?: boolean }> {
  const exportRows = ACTIVE_SUBSCRIPTION_EXPORT.length;
  if (!SUPABASE_URL || !SERVICE_KEY) return { dbRows: null, exportRows };
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_access?select=email`,
      { headers: { ...sbHeaders(), Prefer: 'count=exact', Range: '0-0' } },
    );
    if (r.status === 404) return { dbRows: null, exportRows, tableMissing: true };
    if (!r.ok) return { dbRows: null, exportRows };
    const range = r.headers.get('content-range'); // e.g. 0-0/126
    const total = range?.split('/')[1];
    const dbRows = total && total !== '*' ? parseInt(total, 10) : null;
    return { dbRows: Number.isFinite(dbRows as number) ? dbRows : null, exportRows };
  } catch {
    return { dbRows: null, exportRows };
  }
}
