import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORE_ID       = process.env.SHOPIFY_STORE_ID!;
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

function sb(path: string, method = 'GET', body?: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Prefer': method === 'POST' ? 'return=representation,resolution=merge-duplicates' : '',
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
    const data = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    const email = data?.data?.customer?.emailAddress?.emailAddress ?? '';
    return CREATOR_EMAILS.has(email.toLowerCase());
  } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const isCreator = await verifyCreator(token);
  if (!isCreator) return res.status(403).json({ error: 'Forbidden' });

  // ── GET: list all testers ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const r = await sb('testers?order=created_at.desc&select=email,status,notes,created_at');
      if (!r.ok) {
        const text = await r.text();
        if (r.status === 404 || text.includes('does not exist')) {
          return res.status(200).json({ testers: [] });
        }
        console.error('Testers GET error:', r.status, text);
        return res.status(500).json({ error: 'Failed to load testers' });
      }
      const testers = await r.json() as unknown[];
      return res.status(200).json({ testers });
    } catch (e) {
      console.error('Testers GET exception:', e);
      return res.status(500).json({ error: 'Failed to load testers' });
    }
  }

  // ── POST: mutate a tester record ──────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, email, notes } = req.body as { action?: string; email?: string; notes?: string };
    if (!action || !email) return res.status(400).json({ error: 'action and email required' });
    const emailLower = email.toLowerCase().trim();

    try {
      if (action === 'add') {
        const r = await sb('testers', 'POST', {
          email: emailLower,
          status: 'active',
          notes: notes ?? null,
        });
        if (!r.ok) {
          const text = await r.text();
          console.error('Testers add error:', r.status, text);
          return res.status(500).json({ error: 'Failed to add tester' });
        }
        return res.status(200).json({ ok: true });
      }

      if (action === 'pause') {
        await sb(`testers?email=eq.${encodeURIComponent(emailLower)}`, 'PATCH', { status: 'paused' });
        return res.status(200).json({ ok: true });
      }

      if (action === 'resume') {
        await sb(`testers?email=eq.${encodeURIComponent(emailLower)}`, 'PATCH', { status: 'active' });
        return res.status(200).json({ ok: true });
      }

      if (action === 'remove') {
        await sb(`testers?email=eq.${encodeURIComponent(emailLower)}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
      console.error('Testers POST exception:', e);
      return res.status(500).json({ error: 'Action failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
