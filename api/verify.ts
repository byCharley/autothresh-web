import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const TESTER_EMAILS = new Set(
  (process.env.TESTER_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

const SUPABASE_URL  = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function detectDevice(ua: string): string {
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|opera mini|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function logEvent(data: Record<string, unknown>) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    body: JSON.stringify(data),
  }).catch(() => { /* non-blocking */ });
}

const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN!;
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

async function sealCheckSubscription(email: string): Promise<{ hasSub: boolean; subscriptionStatus?: string; nextBillingDate?: string; planTitle?: string }> {
  try {
    const url = `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`;
    console.log('Seal request:', url, 'token present:', !!SEAL_TOKEN);

    const r = await fetch(url, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
    const rawText = await r.text();
    console.log('Seal HTTP status:', r.status);
    console.log('Seal raw response:', rawText.slice(0, 800));

    if (!r.ok) return { hasSub: false };

    const raw = JSON.parse(rawText) as unknown;

    // Extract subscription array — Seal wraps in { payload: { subscriptions: [...] } }
    let subs: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) {
      subs = raw as Array<Record<string, unknown>>;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload && Array.isArray(payload.subscriptions)) {
        subs = payload.subscriptions as Array<Record<string, unknown>>;
      } else {
        for (const key of ['subscriptions', 'data', 'result', 'subscription_contracts']) {
          if (Array.isArray(obj[key])) { subs = obj[key] as Array<Record<string, unknown>>; break; }
        }
      }
    }

    console.log('Seal parsed subs count:', subs.length);
    if (subs[0]) console.log('Seal sub[0] keys:', JSON.stringify(subs[0]));

    let nextBillingDate: string | undefined;
    let planTitle: string | undefined;
    let subscriptionStatus: string | undefined;
    const TRIAL_DAYS = parseInt(process.env.SEAL_TRIAL_DAYS ?? '3');

    const hasSub = subs.some(s => {
      const st = String(s.status ?? '').toUpperCase();
      const valid = st === 'ACTIVE' || st === 'PAUSED' || st === 'CANCELLED' || st === 'CANCELED' || st === 'TRIAL';

      // Seal uses subscription_type=2 for trials; infer end date from order_placed + TRIAL_DAYS
      const trialEndExplicit = (s.trial_end_date ?? s.trial_ends_on ?? s.free_trial_end_date ?? s.trial_end ?? s.free_trial_end ?? s.trial_ends_at) as string | undefined;
      const isTrialType = Number(s.subscription_type) === 2;
      const orderPlaced = s.order_placed as string | undefined;
      const trialEndInferred = isTrialType && orderPlaced
        ? new Date(new Date(orderPlaced).getTime() + TRIAL_DAYS * 86_400_000).toISOString()
        : undefined;
      const trialEndRaw = trialEndExplicit ?? trialEndInferred;
      const isInTrial = st === 'TRIAL' || (!!trialEndRaw && new Date(trialEndRaw) > new Date());

      // Seal nests plan name inside items array
      const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
      const itemPlanName = items[0]?.selling_plan_name ?? items[0]?.title;

      if (valid) {
        subscriptionStatus = (isInTrial && (st === 'ACTIVE' || st === 'TRIAL')) ? 'trial' : st.toLowerCase();
        nextBillingDate = isInTrial
          ? trialEndRaw
          : (s.next_billing_date ?? s.next_charge_scheduled_at ?? s.next_charge_at ?? s.nextBillingDate ?? s.billing_date) as string | undefined;
        planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? itemPlanName) as string | undefined;
      }
      return valid;
    });
    return { hasSub, subscriptionStatus, nextBillingDate, planTitle };
  } catch (e) {
    console.error('Seal check error:', e);
    return { hasSub: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ valid: false, error: 'Token required' });

  // ── Validate token + get customer info ────────────────────────────────────
  let custData: { data?: Record<string, unknown>; errors?: unknown[] } = {};
  let rawCust = '';
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({
        query: `query { customer { firstName emailAddress { emailAddress } } }`,
      }),
    });
    rawCust = await r.text();
    custData = JSON.parse(rawCust);
  } catch (e) {
    console.error('verify customerApiQuery error:', e, 'raw:', rawCust.slice(0, 200));
    return res.status(200).json({ valid: false });
  }

  type CustNode = { firstName?: string; emailAddress?: { emailAddress: string } };
  const cust = (custData.data as { customer?: CustNode })?.customer;
  console.log('verify customer:', JSON.stringify({ hasCust: !!cust, errors: custData.errors }));
  if (!cust) return res.status(200).json({ valid: false });

  const email = cust.emailAddress?.emailAddress ?? '';
  const emailLower = email.toLowerCase();
  const isCreator = CREATOR_EMAILS.has(emailLower);
  const isTester  = !isCreator && TESTER_EMAILS.has(emailLower);

  // ── Check subscription via Seal ───────────────────────────────────────────
  const { hasSub, subscriptionStatus, nextBillingDate, planTitle } = await sealCheckSubscription(email);
  const finalHasSub = hasSub || isCreator || isTester;

  const finalStatus   = isCreator ? 'creator' : isTester ? 'tester' : subscriptionStatus;
  const finalPlan     = isCreator ? 'Creator' : isTester ? 'Tester Access' : planTitle;
  const finalExpiry   = (isCreator || isTester) ? undefined : nextBillingDate;

  console.log('Verify result:', { email, hasSub, isCreator, isTester, finalHasSub, finalStatus, nextBillingDate, planTitle });

  // ── Log analytics event (fire-and-forget) ─────────────────────────────────
  const ua = String(req.headers['user-agent'] ?? '');
  logEvent({
    event_type:  'app_open',
    email:       emailLower,
    device_type: detectDevice(ua),
    country:     req.headers['x-vercel-ip-country'] ?? req.headers['x-vercel-ip-country-region'] ?? null,
    city:        req.headers['x-vercel-ip-city'] ? decodeURIComponent(String(req.headers['x-vercel-ip-city'])) : null,
  });

  return res.status(200).json({
    valid:                 true,
    hasSubscription:       finalHasSub,
    subscriptionStatus:    finalStatus,
    subscriptionExpiresAt: finalExpiry,
    planTitle:             finalPlan,
    email,
    firstName:             cust.firstName ?? '',
  });
}
