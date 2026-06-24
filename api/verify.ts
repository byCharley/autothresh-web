import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const TESTER_EMAILS = new Set(
  (process.env.TESTER_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN!;
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

async function sealCheckSubscription(email: string): Promise<{ hasSub: boolean; nextBillingDate?: string }> {
  try {
    const url = `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`;
    console.log('Seal request:', url, 'token present:', !!SEAL_TOKEN);

    const r = await fetch(url, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
    const rawText = await r.text();
    console.log('Seal HTTP status:', r.status);
    console.log('Seal raw response:', rawText.slice(0, 800));

    if (!r.ok) return { hasSub: false };

    const raw = JSON.parse(rawText) as unknown;

    // Extract array — Seal may wrap in various keys or return a bare array
    let subs: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) {
      subs = raw as Array<Record<string, unknown>>;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      for (const key of ['subscriptions', 'data', 'result', 'subscription_contracts']) {
        if (Array.isArray(obj[key])) { subs = obj[key] as Array<Record<string, unknown>>; break; }
      }
    }

    console.log('Seal parsed subs count:', subs.length, 'statuses:', subs.map(s => s.status));

    let nextBillingDate: string | undefined;
    const hasSub = subs.some(s => {
      // Accept any capitalisation: ACTIVE, Active, active
      const st = String(s.status ?? '').toUpperCase();
      const active = st === 'ACTIVE' || st === 'PAUSED';
      if (active) {
        nextBillingDate = (s.next_billing_date ?? s.next_charge_at ?? s.nextBillingDate) as string | undefined;
      }
      return active;
    });
    return { hasSub, nextBillingDate };
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

  // ── Check subscription via Seal ───────────────────────────────────────────
  const { hasSub, nextBillingDate } = await sealCheckSubscription(email);
  const finalHasSub = hasSub || TESTER_EMAILS.has(email.toLowerCase());

  console.log('Verify result:', { email, hasSub, finalHasSub, nextBillingDate });

  return res.status(200).json({
    valid:                 true,
    hasSubscription:       finalHasSub,
    subscriptionExpiresAt: nextBillingDate,
    email,
    firstName:             cust.firstName ?? '',
  });
}
