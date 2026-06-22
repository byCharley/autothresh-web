import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Supabase REST helpers ────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation',
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = await verifyToken(req.headers.authorization ?? '');
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  // GET — list user's presets
  if (req.method === 'GET') {
    const url = `${SUPABASE_URL}/rest/v1/presets?user_email=eq.${encodeURIComponent(email)}&order=updated_at.desc&select=id,name,data,created_at,updated_at`;
    const r = await fetch(url, { headers: sbHeaders() });
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    return res.status(200).json(await r.json());
  }

  // POST — save new preset
  if (req.method === 'POST') {
    const { name, data } = req.body as { name?: string; data?: unknown };
    if (!name?.trim() || !data) return res.status(400).json({ error: 'name and data required' });
    const url = `${SUPABASE_URL}/rest/v1/presets`;
    const r = await fetch(url, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({ user_email: email, name: name.trim(), data }),
    });
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    const rows = await r.json() as unknown[];
    return res.status(201).json(rows[0]);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
