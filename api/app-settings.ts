import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

function sb(path: string, method = 'GET', body?: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function verifyCreator(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ query: `query { customer { emailAddress { emailAddress } } }` }),
    });
    const body = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    const email = body?.data?.customer?.emailAddress?.emailAddress ?? '';
    return CREATOR_EMAILS.has(email.toLowerCase());
  } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — public, returns all settings as { key: value } map
  if (req.method === 'GET') {
    try {
      const r = await sb('app_settings?select=key,value');
      if (!r.ok) return res.status(200).json({});
      const rows = await r.json() as Array<{ key: string; value: string }>;
      const map: Record<string, string> = {};
      for (const { key, value } of rows) map[key] = value;
      return res.status(200).json(map);
    } catch {
      return res.status(200).json({});
    }
  }

  // PATCH — creator only, upserts a setting
  if (req.method === 'PATCH') {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const isCreator = await verifyCreator(token);
    if (!isCreator) return res.status(403).json({ error: 'Forbidden' });

    const { key, value } = req.body as { key?: string; value?: string };
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });

    const allowed = ['app_version'];
    if (!allowed.includes(key)) return res.status(400).json({ error: `Unknown setting key: ${key}` });

    try {
      await sb('app_settings', 'POST', {
        key, value, updated_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'Failed to save setting' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
