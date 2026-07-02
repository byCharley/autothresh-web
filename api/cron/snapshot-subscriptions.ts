import type { VercelRequest, VercelResponse } from '@vercel/node';

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN!;
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET  = process.env.CRON_SECRET ?? '';

async function getSealCounts(): Promise<{ active: number; trial: number; paused: number; cancelled: number; total: number }> {
  const counts = { active: 0, trial: 0, paused: 0, cancelled: 0, total: 0 };
  try {
    const r = await fetch(`${SEAL_API_URL}/subscriptions`, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
    if (!r.ok) return counts;
    const raw = await r.json() as unknown;
    let subs: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) {
      subs = raw;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload && Array.isArray(payload.subscriptions)) subs = payload.subscriptions as Array<Record<string, unknown>>;
      else for (const k of ['subscriptions', 'data']) { if (Array.isArray(obj[k])) { subs = obj[k] as Array<Record<string, unknown>>; break; } }
    }
    for (const s of subs) {
      const st = String(s.status ?? '').toUpperCase();
      counts.total++;
      if (st === 'ACTIVE') counts.active++;
      else if (st === 'TRIAL') counts.trial++;
      else if (st === 'PAUSED') counts.paused++;
      else if (st === 'CANCELLED' || st === 'CANCELED') counts.cancelled++;
    }
  } catch (e) {
    console.error('Seal error:', e);
  }
  return counts;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  // Allow if secret matches OR if running in Vercel's internal cron context (no secret configured)
  const authHeader = String(req.headers.authorization ?? '');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const counts = await getSealCounts();
  console.log('Subscription snapshot:', counts);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/subscription_snapshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(counts),
  });

  if (!r.ok) {
    const body = await r.text();
    console.error('Supabase snapshot write failed:', r.status, body);
    return res.status(500).json({ error: `Supabase ${r.status}` });
  }

  return res.status(200).json({ ok: true, snapshot: counts });
}
