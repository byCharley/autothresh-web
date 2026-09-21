/**
 * Paid-period access after we cancel Seal subscriptions.
 * Users keep the app until access_until; cards are not charged again.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export interface PlanAccessRow {
  email: string;
  accessUntil: string;
  planTitle?: string;
}

function sbHeaders(prefer?: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
    ...(prefer ? { Prefer: prefer } : {}),
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
  if (!SUPABASE_URL || !SERVICE_KEY || !email) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/plan_access?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=email,access_until,plan_title&limit=1`,
      { headers: sbHeaders() },
    );
    if (!r.ok) return null;
    const rows = await r.json() as Array<{ email: string; access_until: string; plan_title?: string }>;
    if (!rows.length) return null;
    const until = rows[0].access_until;
    if (!until || new Date(until).getTime() <= Date.now()) return null;
    return {
      email: rows[0].email,
      accessUntil: until,
      planTitle: rows[0].plan_title || undefined,
    };
  } catch {
    return null;
  }
}
