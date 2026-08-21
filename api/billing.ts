import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);
const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

type SubStatus = 'active' | 'trial' | 'paused' | 'cancelled';

interface SealSub {
  id: number;
  status: SubStatus;
  planTitle?: string;
  nextBillingDate?: string;
}

function sealHeaders() {
  return { 'Content-Type': 'application/json', 'X-Seal-Token': SEAL_TOKEN };
}

async function identify(token: string): Promise<{ email: string; isCreator: boolean } | null> {
  if (!token) return null;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ query: `query { customer { emailAddress { emailAddress } } }` }),
    });
    const body = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    const email = (body.data?.customer?.emailAddress?.emailAddress ?? '').toLowerCase();
    if (!email) return null;
    return { email, isCreator: CREATOR_EMAILS.has(email) };
  } catch { return null; }
}

function parseSubs(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (payload && Array.isArray(payload.subscriptions)) return payload.subscriptions as Array<Record<string, unknown>>;
    for (const key of ['subscriptions', 'data', 'result', 'subscription_contracts']) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function mapSub(s: Record<string, unknown>): SealSub | null {
  const id = Number(s.id);
  if (!id) return null;
  const st = String(s.status ?? '').toUpperCase();
  const billingInterval = String(s.billing_interval ?? '').toLowerCase();
  const isAnnualPlan = billingInterval.includes('year') || billingInterval.includes('annual');
  const TRIAL_DAYS = parseInt(process.env.SEAL_TRIAL_DAYS ?? '3');
  const trialEndExplicit = (s.trial_end_date ?? s.trial_ends_on ?? s.free_trial_end_date ?? s.trial_end ?? s.free_trial_end ?? s.trial_ends_at) as string | undefined;
  const orderPlaced = s.order_placed as string | undefined;
  const trialEndInferred = Number(s.subscription_type) === 2 && isAnnualPlan && orderPlaced
    ? new Date(new Date(orderPlaced).getTime() + TRIAL_DAYS * 86_400_000).toISOString()
    : undefined;
  const trialEndRaw = trialEndExplicit ?? trialEndInferred;
  const trialStillActive = !!trialEndRaw && new Date(trialEndRaw) > new Date();
  const isInTrial = (st === 'TRIAL' || (st === 'ACTIVE' && trialStillActive)) && isAnnualPlan;

  let status: SubStatus;
  if (st === 'PAUSED') status = 'paused';
  else if (st === 'CANCELLED' || st === 'CANCELED') status = 'cancelled';
  else if (st === 'ACTIVE' || st === 'TRIAL') status = isInTrial ? 'trial' : 'active';
  else return null;

  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  const itemPlanName = items[0]?.selling_plan_name ?? items[0]?.title;
  const nextBillingDate = isInTrial
    ? trialEndRaw
    : (s.next_billing_date ?? s.next_charge_scheduled_at ?? s.next_charge_at ?? s.nextBillingDate ?? s.billing_date) as string | undefined;
  const planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? itemPlanName) as string | undefined;
  return { id, status, planTitle, nextBillingDate };
}

function pickSub(subs: Array<Record<string, unknown>>): SealSub | null {
  const mapped = subs.map(mapSub).filter((s): s is SealSub => !!s);
  const rank = (s: SealSub) => s.status === 'active' || s.status === 'trial' ? 0 : s.status === 'paused' ? 1 : 2;
  mapped.sort((a, b) => rank(a) - rank(b));
  return mapped[0] ?? null;
}

async function loadSub(email: string): Promise<SealSub | null> {
  const r = await fetch(`${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`, { headers: sealHeaders() });
  if (!r.ok) return null;
  return pickSub(parseSubs(await r.json()));
}

function billingDateParts(iso?: string): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toISOString().slice(0, 10);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { date, time: `${hh}:${mm}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawToken = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const user = await identify(rawToken);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.isCreator) return res.status(200).json({ manageable: false, reason: 'creator' });

  const sub = await loadSub(user.email);
  if (!sub) return res.status(200).json({ manageable: false, reason: 'none' });

  if (req.method === 'GET') {
    return res.status(200).json({
      manageable: sub.status === 'active' || sub.status === 'trial' || sub.status === 'paused',
      status: sub.status,
      planTitle: sub.planTitle,
      nextBillingDate: sub.nextBillingDate,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = String((req.body as { action?: string })?.action ?? '');
  if (!['pause', 'resume', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'Unknown action' });
  }

  if (action === 'cancel') {
    if (sub.status === 'cancelled') return res.status(200).json({ ok: true, status: 'cancelled' });
    const parts = billingDateParts(sub.nextBillingDate);
    if (!parts) {
      return res.status(400).json({ error: 'Could not find your renewal date. Email autothreshweb@gmail.com and we will cancel it for you.' });
    }
    const r = await fetch(`${SEAL_API_URL}/subscription-schedule-cancellation`, {
      method: 'PUT',
      headers: sealHeaders(),
      body: JSON.stringify({ id: sub.id, date: parts.date, time: parts.time, timezone: '+00:00' }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('Seal schedule-cancellation failed:', r.status, err);
      return res.status(500).json({ error: 'Could not schedule cancellation. Please try again or email support.' });
    }
    return res.status(200).json({ ok: true, status: sub.status, cancelsOn: sub.nextBillingDate });
  }

  const sealAction = action === 'pause' ? 'pause' : 'resume';
  const r = await fetch(`${SEAL_API_URL}/subscription`, {
    method: 'PUT',
    headers: sealHeaders(),
    body: JSON.stringify({ id: sub.id, action: sealAction }),
  });
  if (!r.ok) {
    const err = await r.text();
    console.error('Seal subscription action failed:', sealAction, r.status, err);
    return res.status(500).json({ error: action === 'pause' ? 'Could not pause your subscription.' : 'Could not resume your subscription.' });
  }
  return res.status(200).json({ ok: true, status: action === 'pause' ? 'paused' : 'active' });
}
