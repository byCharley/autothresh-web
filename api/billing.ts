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
  const text = [
    s.billing_interval, s.interval, s.plan_title, s.product_title, s.plan_name,
    ...(Array.isArray(s.items) ? (s.items as Array<Record<string, unknown>>).map(i => String(i.selling_plan_name ?? i.title ?? '')) : []),
  ].filter(Boolean).join(' ').toLowerCase();
  const isMonthly = text.includes('month') && !text.includes('12 month') && !text.includes('year');
  const TRIAL_DAYS = parseInt(process.env.SEAL_TRIAL_DAYS ?? '3', 10);
  const trialEndExplicit = (s.trial_end_date ?? s.trial_ends_on ?? s.free_trial_end_date ?? s.trial_end ?? s.free_trial_end ?? s.trial_ends_at) as string | undefined;
  const orderPlaced = s.order_placed as string | undefined;
  const isTrialType = Number(s.subscription_type) === 2 && !isMonthly;
  const trialEndInferred = isTrialType && orderPlaced
    ? new Date(new Date(orderPlaced).getTime() + TRIAL_DAYS * 86_400_000).toISOString()
    : undefined;
  const trialEndRaw = trialEndExplicit ?? trialEndInferred;
  const trialStillActive = !!trialEndRaw && new Date(trialEndRaw) > new Date();
  const isInTrial = !isMonthly && (st === 'TRIAL' || ((st === 'ACTIVE' || st === 'PAUSED') && trialStillActive) || (isTrialType && trialStillActive));

  let status: SubStatus;
  if (st === 'PAUSED') status = 'paused';
  else if (st === 'CANCELLED' || st === 'CANCELED') status = 'cancelled';
  else if (st === 'ACTIVE' || st === 'TRIAL') status = isInTrial ? 'trial' : 'active';
  else return null;

  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  const itemPlanName = items[0]?.selling_plan_name ?? items[0]?.title;
  const nextBillingDate = firstUsableDate(
    s.next_billing_date,
    s.next_charge_scheduled_at,
    s.next_charge_at,
    s.nextBillingDate,
    s.billing_date,
    nextAttemptDate(s),
    trialEndRaw,
    isTrialType ? trialEndInferred : undefined,
  );
  const planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? itemPlanName) as string | undefined;
  return { id, status, planTitle, nextBillingDate };
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

function firstUsableDate(...vals: unknown[]): string | undefined {
  const now = Date.now() - 60_000;
  for (const v of vals) {
    const d = parseWhen(v);
    if (d && d.getTime() > now) return d.toISOString();
  }
  return undefined;
}

function nextAttemptDate(s: Record<string, unknown>): string | undefined {
  const attempts = Array.isArray(s.billing_attempts) ? s.billing_attempts as Array<Record<string, unknown>> : [];
  const now = Date.now();
  const upcoming = attempts
    .filter(a => {
      const st = String(a.status ?? '').toLowerCase();
      return st !== 'completed' && st !== 'success' && !a.completed_at;
    })
    .map(a => parseWhen(a.date))
    .filter((d): d is Date => !!d && d.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0]?.toISOString();
}

function pickSub(subs: Array<Record<string, unknown>>): Record<string, unknown> | null {
  const ranked = subs
    .map(s => ({ raw: s, mapped: mapSub(s) }))
    .filter((x): x is { raw: Record<string, unknown>; mapped: SealSub } => !!x.mapped);
  const rank = (s: SealSub) => s.status === 'active' || s.status === 'trial' ? 0 : s.status === 'paused' ? 1 : 2;
  ranked.sort((a, b) => rank(a.mapped) - rank(b.mapped));
  return ranked[0]?.raw ?? null;
}

async function fetchSubById(id: number): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${SEAL_API_URL}/subscription?id=${id}`, { headers: sealHeaders() });
  if (!r.ok) return null;
  const raw = await r.json() as { payload?: Record<string, unknown> } & Record<string, unknown>;
  if (raw.payload && typeof raw.payload === 'object') return raw.payload;
  if (raw.id) return raw;
  return null;
}

async function loadSub(email: string): Promise<SealSub | null> {
  const r = await fetch(
    `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}&with-items=true&with-billing-attempts=true`,
    { headers: sealHeaders() },
  );
  if (!r.ok) return null;
  const listed = pickSub(parseSubs(await r.json()));
  if (!listed) return null;
  let mapped = mapSub(listed);
  if (mapped && !mapped.nextBillingDate) {
    const full = await fetchSubById(mapped.id);
    if (full) mapped = mapSub(full) ?? mapped;
  }
  return mapped;
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
    const r = await fetch(`${SEAL_API_URL}/subscription`, {
      method: 'PUT',
      headers: sealHeaders(),
      body: JSON.stringify({ id: sub.id, action: 'cancel' }),
    });
    if (!r.ok) {
      console.error('Seal cancel failed:', r.status, await r.text());
      return res.status(500).json({ error: 'Could not cancel your subscription. Please try again or email autothreshweb@gmail.com.' });
    }
    return res.status(200).json({ ok: true, status: 'cancelled' });
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
