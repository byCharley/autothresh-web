import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Supabase REST helpers ────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  };
}

// ── Shopify token verification ───────────────────────────────────────────────
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

async function verifyToken(token: string): Promise<string | null> {
  if (!token) return null;
  if (token === 'dev-bypass' && process.env.VERCEL_ENV !== 'production') return 'dev@localhost';
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ query: `query { customer { emailAddress { emailAddress } } }` }),
    });
    const body = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    return body?.data?.customer?.emailAddress?.emailAddress ?? null;
  } catch { return null; }
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = await verifyToken(req.headers.authorization ?? '');
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });

  // DELETE — only owner can delete their preset
  if (req.method === 'DELETE') {
    const url = `${SUPABASE_URL}/rest/v1/presets?id=eq.${id}&user_email=eq.${encodeURIComponent(email)}`;
    const r = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
