import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const TESTER_EMAILS = new Set(
  (process.env.TESTER_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN!;
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

type SealSub = {
  status: string;
  next_billing_date?: string;
  next_charge_at?: string;
};

type SealResponse = SealSub[] | { subscriptions?: SealSub[] } | { data?: SealSub[] };

async function sealCheckSubscription(email: string): Promise<{ hasSub: boolean; nextBillingDate?: string }> {
  try {
    const r = await fetch(
      `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`,
      { headers: { 'X-Seal-Token': SEAL_TOKEN } },
    );
    if (!r.ok) {
      console.error('Seal API HTTP error:', r.status, (await r.text()).slice(0, 200));
      return { hasSub: false };
    }
    const raw = await r.json() as SealResponse;

    const subs: SealSub[] = Array.isArray(raw)
      ? raw
      : (raw as { subscriptions?: SealSub[] }).subscriptions
        ?? (raw as { data?: SealSub[] }).data
        ?? [];

    console.log('Seal subs for', email, ':', JSON.stringify(subs.map(s => ({ status: s.status }))));

    let nextBillingDate: string | undefined;
    const hasSub = subs.some(s => {
      const active = s.status === 'ACTIVE' || s.status === 'PAUSED';
      if (active) nextBillingDate = s.next_billing_date ?? s.next_charge_at;
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
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({
        query: `query { customer { firstName emailAddress { emailAddress } } }`,
      }),
    });
    custData = JSON.parse(await r.text());
  } catch (e) {
    console.error('verify customerApiQuery error:', e);
    return res.status(200).json({ valid: false });
  }

  type CustNode = { firstName?: string; emailAddress?: { emailAddress: string } };
  const cust = (custData.data as { customer?: CustNode })?.customer;
  if (!cust) return res.status(200).json({ valid: false });

  const email = cust.emailAddress?.emailAddress ?? '';

  // ── Check subscription via Seal ───────────────────────────────────────────
  const { hasSub, nextBillingDate } = await sealCheckSubscription(email);
  const finalHasSub = hasSub || TESTER_EMAILS.has(email.toLowerCase());

  console.log('Verify result:', { email, hasSub, finalHasSub });

  return res.status(200).json({
    valid:                true,
    hasSubscription:      finalHasSub,
    subscriptionExpiresAt: nextBillingDate,
    email,
    firstName:            cust.firstName ?? '',
  });
}
