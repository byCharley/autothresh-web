import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const STORE_ID     = process.env.SHOPIFY_STORE_ID ?? '';
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

const ALLOWED = new Set([
  'mode_change',
  'export',
  'mockup_open',
  'presets_open',
  'tutorial_open',
  'tool_brush',
  'tool_remove_bg',
  'tool_registration_marks',
]);

function detectDevice(ua: string): string {
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|opera mini|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

async function identify(token: string): Promise<string | null> {
  if (!token || !STORE_ID) return null;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ query: 'query { customer { emailAddress { emailAddress } } }' }),
    });
    const body = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    return (body.data?.customer?.emailAddress?.emailAddress ?? '').toLowerCase() || null;
  } catch {
    return null;
  }
}

function readBody(req: VercelRequest): { event?: string; props?: Record<string, unknown> } {
  if (typeof req.body === 'object' && req.body && !Buffer.isBuffer(req.body)) {
    return req.body as { event?: string; props?: Record<string, unknown> };
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body) as { event?: string; props?: Record<string, unknown> }; } catch { return {}; }
  }
  return {};
}

async function insertEvent(row: Record<string, unknown>): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;

  // Prefer meta jsonb; fall back without meta if the column is missing.
  const withMeta = { ...row };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(withMeta),
  });
  if (r.ok) return true;

  const err = await r.text().catch(() => '');
  if (err.includes('meta') || err.includes('column')) {
    const { meta: _m, ...rest } = withMeta;
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rest),
    });
    return r2.ok;
  }
  console.error('[track] insert failed', r.status, err.slice(0, 200));
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // sendBeacon cannot set Authorization; accept ?auth= as a fallback.
  const headerToken = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const queryToken = typeof req.query.auth === 'string' ? req.query.auth : '';
  const token = headerToken || queryToken;
  const email = await identify(token);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { event, props } = readBody(req);
  const eventType = String(event ?? '').trim();
  if (!ALLOWED.has(eventType)) return res.status(400).json({ error: 'Unknown event' });

  const ua = String(req.headers['user-agent'] ?? '');
  const country = String(req.headers['x-vercel-ip-country'] ?? '');
  const city = req.headers['x-vercel-ip-city']
    ? decodeURIComponent(String(req.headers['x-vercel-ip-city']))
    : '';

  const cleanProps: Record<string, string | number | boolean> = {};
  if (props && typeof props === 'object') {
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        cleanProps[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 80) : v;
      }
    }
  }

  const ok = await insertEvent({
    event_type: eventType,
    email,
    device_type: detectDevice(ua),
    country: country || null,
    city: city || null,
    meta: Object.keys(cleanProps).length ? cleanProps : null,
  });

  // Always 204 to clients — analytics must never block UX.
  return res.status(ok ? 204 : 204).end();
}
