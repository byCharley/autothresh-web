import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLIENT_ID    = process.env.customer!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';

const TESTER_EMAILS = new Set(
  (process.env.TESTER_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

// Customer Account API
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

// Seal Subscriptions API — token is unique per shop, found in Seal app > Settings > General > API
// API_SECRET is for webhook HMAC verification only; not needed for read requests.
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

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, codeVerifier } = req.body as { code?: string; codeVerifier?: string };
  if (!code || !codeVerifier) return res.status(400).json({ error: 'code and codeVerifier required' });

  // ── 1. Exchange code for tokens ────────────────────────────────────────────
  const tokenRes = await fetch(
    `https://shopify.com/authentication/${STORE_ID}/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
        code,
        code_verifier: codeVerifier,
      }),
    }
  );

  const tokenBody = await tokenRes.text();
  if (!tokenRes.ok) {
    console.error('Token exchange HTTP error:', tokenRes.status, tokenBody.slice(0, 300));
    return res.status(401).json({ error: 'Token exchange failed' });
  }

  let tokens: { access_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string };
  try {
    tokens = JSON.parse(tokenBody);
  } catch {
    console.error('Token exchange: non-JSON response:', tokenBody.slice(0, 300));
    return res.status(401).json({ error: 'Token exchange bad response' });
  }

  if (tokens.error || !tokens.access_token || !tokens.id_token) {
    console.error('Token exchange error:', tokens.error, tokens.error_description);
    return res.status(401).json({ error: tokens.error ?? 'Token exchange missing fields' });
  }

  // ── 2. Get email from id_token ────────────────────────────────────────────
  const claims    = decodeJwtPayload(tokens.id_token);
  const email     = claims.email as string;
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

  // ── 3. Get customer name from Customer Account API ─────────────────────────
  let firstName = '';
  let custEmail = email;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': tokens.access_token },
      body: JSON.stringify({
        query: `query { customer { firstName emailAddress { emailAddress } } }`,
      }),
    });
    const body = await r.json() as { data?: { customer?: { firstName?: string; emailAddress?: { emailAddress: string } } } };
    const cust = body.data?.customer;
    if (cust) {
      firstName = cust.firstName ?? '';
      custEmail = cust.emailAddress?.emailAddress ?? email;
    }
    console.log('Customer API:', { firstName, custEmail });
  } catch (e) {
    console.error('Customer API error:', e);
  }

  // ── 4. Check subscription via Seal ────────────────────────────────────────
  const { hasSub, nextBillingDate } = await sealCheckSubscription(custEmail);

  // Tester email override — grants access without a subscription
  const finalHasSub = hasSub || TESTER_EMAILS.has(custEmail.toLowerCase());

  console.log('Auth result:', { custEmail, hasSub, finalHasSub, nextBillingDate });

  return res.status(200).json({
    token:                tokens.access_token,
    idToken:              tokens.id_token,
    expiresAt,
    email:                custEmail,
    firstName,
    hasSubscription:      finalHasSub,
    subscriptionExpiresAt: nextBillingDate,
  });
}
