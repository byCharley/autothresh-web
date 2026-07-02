import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const SEAL_TOKEN   = process.env.SEAL_API_TOKEN!;
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  };
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

async function sbQuery(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase ${path} → ${r.status}`);
  return r.json() as Promise<Array<Record<string, unknown>>>;
}

async function getSealSubscriptionCounts(): Promise<{ active: number; trial: number; paused: number; cancelled: number; total: number }> {
  const counts = { active: 0, trial: 0, paused: 0, cancelled: 0, total: 0 };
  try {
    const r = await fetch(`${SEAL_API_URL}/subscriptions`, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
    if (!r.ok) return counts;
    const raw = await r.json() as unknown;
    let subs: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) {
      subs = raw;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload && Array.isArray(payload.subscriptions)) subs = payload.subscriptions as Array<Record<string, unknown>>;
      else for (const key of ['subscriptions', 'data']) { if (Array.isArray(obj[key])) { subs = obj[key] as Array<Record<string, unknown>>; break; } }
    }
    for (const s of subs) {
      const st = String(s.status ?? '').toUpperCase();
      counts.total++;
      if (st === 'ACTIVE') counts.active++;
      else if (st === 'TRIAL') counts.trial++;
      else if (st === 'PAUSED') counts.paused++;
      else if (st === 'CANCELLED' || st === 'CANCELED') counts.cancelled++;
    }
  } catch { /* best effort */ }
  return counts;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const isCreator = await verifyCreator(token);
  if (!isCreator) return res.status(403).json({ error: 'Forbidden' });

  const days  = Math.min(parseInt(String(req.query.days ?? '30')), 365);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    // ── Parallel fetch: Supabase events + Seal subscriptions ────────────────
    const [events, subscriptions] = await Promise.all([
      sbQuery(
        `analytics_events?select=created_at,event_type,email,device_type,country,city&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=50000`
      ),
      getSealSubscriptionCounts(),
    ]);

    // ── Daily aggregation ───────────────────────────────────────────────────
    const dailyMap = new Map<string, { logins: number; opens: number; unique: Set<string> }>();
    const deviceCounts: Record<string, number> = { desktop: 0, mobile: 0, tablet: 0 };
    const countryCounts: Record<string, number> = {};
    const uniqueUsers = new Set<string>();
    let loginCount = 0;
    let appOpenCount = 0;

    for (const ev of events) {
      const day = String(ev.created_at ?? '').slice(0, 10);
      if (!dailyMap.has(day)) dailyMap.set(day, { logins: 0, opens: 0, unique: new Set() });
      const d = dailyMap.get(day)!;

      const email = String(ev.email ?? '');
      if (email) { d.unique.add(email); uniqueUsers.add(email); }

      if (ev.event_type === 'login') { d.logins++; loginCount++; }
      else { d.opens++; appOpenCount++; }

      const dt = String(ev.device_type ?? 'desktop');
      deviceCounts[dt] = (deviceCounts[dt] ?? 0) + 1;

      const cc = String(ev.country ?? 'Unknown');
      countryCounts[cc] = (countryCounts[cc] ?? 0) + 1;
    }

    // Fill gaps in daily timeline
    const dailyTrend: Array<{ date: string; logins: number; opens: number; unique: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const entry = dailyMap.get(key);
      dailyTrend.push({ date: key, logins: entry?.logins ?? 0, opens: entry?.opens ?? 0, unique: entry?.unique.size ?? 0 });
    }

    // Top 15 countries
    const topCountries = Object.entries(countryCounts)
      .filter(([k]) => k && k !== 'Unknown' && k !== 'null')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([country, count]) => ({ country, count }));

    // Peak hour analysis (UTC)
    const hourCounts: number[] = new Array(24).fill(0);
    for (const ev of events) {
      const hour = new Date(String(ev.created_at ?? '')).getUTCHours();
      if (!isNaN(hour)) hourCounts[hour]++;
    }
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

    res.status(200).json({
      period: { days, since },
      summary: {
        totalEvents:  events.length,
        loginCount,
        appOpenCount,
        uniqueUsers:  uniqueUsers.size,
        peakHour,
      },
      devices: deviceCounts,
      countries: topCountries,
      dailyTrend,
      hourly: hourCounts,
      subscriptions,
    });
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
}
