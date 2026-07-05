import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORE_ID       = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL   = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET is public — any user can fetch the tutorial list
  if (req.method === 'GET') {
    try {
      const r = await sb('tutorials?order=sort_order.asc,id.asc&select=*');
      if (!r.ok) return res.status(500).json({ error: 'Failed to load tutorials' });
      const rows = await r.json();
      return res.status(200).json(rows);
    } catch (e) {
      console.error('tutorials GET error:', e);
      return res.status(500).json({ error: 'Failed to load tutorials' });
    }
  }

  // All mutations require creator auth
  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const isCreator = await verifyCreator(token);
  if (!isCreator) return res.status(403).json({ error: 'Forbidden' });

  // POST — create
  if (req.method === 'POST') {
    const { title, description, duration, youtube_id, coming_soon, sort_order } =
      req.body as Record<string, unknown>;
    if (!title || !youtube_id) return res.status(400).json({ error: 'title and youtube_id required' });
    try {
      const r = await sb('tutorials', 'POST', {
        title, description: description ?? '', duration: duration ?? '0:00',
        youtube_id, coming_soon: coming_soon ?? false,
        sort_order: sort_order ?? 999,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = await r.json();
      return res.status(200).json(Array.isArray(rows) ? rows[0] : rows);
    } catch (e) {
      console.error('tutorials POST error:', e);
      return res.status(500).json({ error: 'Failed to create tutorial' });
    }
  }

  // PATCH — update
  if (req.method === 'PATCH') {
    const { id, ...fields } = req.body as Record<string, unknown>;
    if (!id) return res.status(400).json({ error: 'id required' });
    const allowed = ['title', 'description', 'duration', 'youtube_id', 'coming_soon', 'sort_order'];
    const update = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields to update' });
    try {
      await sb(`tutorials?id=eq.${id}`, 'PATCH', update);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('tutorials PATCH error:', e);
      return res.status(500).json({ error: 'Failed to update tutorial' });
    }
  }

  // DELETE
  if (req.method === 'DELETE') {
    const id = req.query.id ?? (req.body as Record<string, unknown>)?.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      await sb(`tutorials?id=eq.${id}`, 'DELETE');
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('tutorials DELETE error:', e);
      return res.status(500).json({ error: 'Failed to delete tutorial' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
