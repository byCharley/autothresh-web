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
    'Prefer': 'count=planned',
  };
}

async function sbQuery(path: string): Promise<Array<Record<string, unknown>>> {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error(`Supabase HTTP ${r.status} for ${path.slice(0, 80)}:`, body.slice(0, 300));
    throw new Error(`Supabase HTTP ${r.status}: ${body.slice(0, 120)}`);
  }
  return r.json() as Promise<Array<Record<string, unknown>>>;
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

function extractSubs(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (payload && Array.isArray(payload.subscriptions)) return payload.subscriptions as Array<Record<string, unknown>>;
    for (const key of ['subscriptions', 'data']) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

async function getSealSubscriptionCounts(): Promise<{ active: number; trial: number; paused: number; cancelled: number; total: number }> {
  const counts = { active: 0, trial: 0, paused: 0, cancelled: 0, total: 0 };
  try {
    let page = 1;
    let fetched = 0;

    // Paginate through all Seal subscriptions — break only on empty page
    while (true) {
      const url = `${SEAL_API_URL}/subscriptions?page=${page}&per_page=50`;
      const r = await fetch(url, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
      if (!r.ok) break;
      const subs = extractSubs(await r.json() as unknown);
      if (subs.length === 0) break; // no more results

      for (const s of subs) {
        const st = String(s.status ?? '').toUpperCase();
        counts.total++;
        if (st === 'ACTIVE') counts.active++;
        else if (st === 'TRIAL') counts.trial++;
        else if (st === 'PAUSED') counts.paused++;
        else if (st === 'CANCELLED' || st === 'CANCELED') counts.cancelled++;
      }

      fetched += subs.length;
      page++;
      if (page > 20) break; // safety cap at 1000 subs
    }

    console.log(`[analytics] Seal: fetched ${fetched} subs across ${page} page(s)`);
  } catch (e) { console.error('[analytics] Seal fetch error:', e); }
  return counts;
}

export interface CancelledSubscriber {
  email: string;
  firstName: string;
  lastName: string;
  planTitle: string;
  billingInterval: string;
  cancelledOn: string;
  orderPlaced: string;
  status: string;
}

async function getCancelledSubscribers(): Promise<CancelledSubscriber[]> {
  const byEmail = new Map<string, CancelledSubscriber>();
  let page = 1;

  while (page <= 40) {
    const url = `${SEAL_API_URL}/subscriptions?cancelled-only=true&with-items=true&page=${page}&per_page=50`;
    const r = await fetch(url, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
    if (!r.ok) {
      console.error('[analytics] Seal cancelled fetch failed:', r.status, await r.text().catch(() => ''));
      break;
    }
    const subs = extractSubs(await r.json() as unknown);
    if (subs.length === 0) break;

    for (const s of subs) {
      const email = String(s.email ?? '').trim().toLowerCase();
      if (!email || !email.includes('@')) continue;

      const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
      const itemPlan = items[0]?.selling_plan_name ?? items[0]?.title;
      const planTitle = String(s.plan_title ?? s.product_title ?? s.plan_name ?? itemPlan ?? '');
      const cancelledOn = String(s.cancelled_on ?? s.canceled_on ?? '');
      const orderPlaced = String(s.order_placed ?? '');
      const row: CancelledSubscriber = {
        email,
        firstName: String(s.first_name ?? s.s_first_name ?? ''),
        lastName: String(s.last_name ?? s.s_last_name ?? ''),
        planTitle,
        billingInterval: String(s.billing_interval ?? ''),
        cancelledOn,
        orderPlaced,
        status: String(s.status ?? 'CANCELLED'),
      };

      const existing = byEmail.get(email);
      // Keep the most recently cancelled subscription per email
      if (!existing || (cancelledOn && cancelledOn > (existing.cancelledOn || ''))) {
        byEmail.set(email, row);
      }
    }

    page++;
  }

  return [...byEmail.values()].sort((a, b) => {
    if (a.cancelledOn && b.cancelledOn) return b.cancelledOn.localeCompare(a.cancelledOn);
    if (a.cancelledOn) return -1;
    if (b.cancelledOn) return 1;
    return a.email.localeCompare(b.email);
  });
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

  // ── Snapshot action (merged from api/snapshot.ts) ─────────────────────────
  if (req.query.action === 'snapshot') {
    const counts = await getSealSubscriptionCounts();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/subscription_snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify(counts),
    });
    if (!r.ok) {
      const body = await r.text();
      console.error('Supabase snapshot write failed:', r.status, body);
      return res.status(500).json({ error: `Supabase ${r.status}` });
    }
    return res.status(200).json({ ok: true, snapshot: counts });
  }

  // ── Cancelled subscriber export (CSV-ready for win-back emails) ───────────
  if (req.query.action === 'cancelled-export') {
    try {
      const subscribers = await getCancelledSubscribers();
      return res.status(200).json({
        count: subscribers.length,
        exportedAt: new Date().toISOString(),
        subscribers,
      });
    } catch (e) {
      console.error('[analytics] cancelled-export error:', e);
      return res.status(500).json({ error: 'Failed to export cancelled subscribers' });
    }
  }

  const fromParam = req.query.from ? String(req.query.from) : null;
  const toParam   = req.query.to   ? String(req.query.to)   : null;

  let since: string;
  let until: string;
  let days: number;

  if (fromParam && toParam) {
    since = new Date(fromParam).toISOString();
    until = new Date(toParam + 'T23:59:59.999Z').toISOString();
    days  = Math.max(1, Math.ceil((new Date(until).getTime() - new Date(since).getTime()) / 86_400_000));
  } else {
    days  = Math.min(parseInt(String(req.query.days ?? '30')), 365);
    since = new Date(Date.now() - days * 86_400_000).toISOString();
    until = new Date().toISOString();
  }

  try {
    const untilMs = new Date(until).getTime();
    const mauSince = new Date(untilMs - 30 * 86_400_000).toISOString();
    const wauSince = new Date(untilMs - 7 * 86_400_000).toISOString();
    const fetchSince = since < mauSince ? since : mauSince;

    // ── Parallel fetch: events + snapshots + Seal live counts ───────────────
    let events: Array<Record<string, unknown>> = [];
    try {
      events = await sbQuery(
        `analytics_events?select=created_at,event_type,email,device_type,country,city,meta&created_at=gte.${fetchSince}&created_at=lte.${until}&order=created_at.asc&limit=20000`,
      );
    } catch {
      // meta column may not exist yet
      events = await sbQuery(
        `analytics_events?select=created_at,event_type,email,device_type,country,city&created_at=gte.${fetchSince}&created_at=lte.${until}&order=created_at.asc&limit=20000`,
      );
    }

    const [snapshots, subscriptions] = await Promise.all([
      sbQuery(
        `subscription_snapshots?select=created_at,active,trial,paused,cancelled,total&created_at=gte.${since}&created_at=lte.${until}&order=created_at.asc&limit=1000`,
      ).catch(() => [] as Array<Record<string, unknown>>),
      getSealSubscriptionCounts(),
    ]);

    const inRange = (iso: string, from: string, to: string) => iso >= from && iso <= to;
    const rangeEvents = events.filter(ev => inRange(String(ev.created_at ?? ''), since, until));

    // ── Daily aggregation (selected range) ──────────────────────────────────
    const dailyMap = new Map<string, { logins: number; opens: number; unique: Set<string> }>();
    const deviceCounts: Record<string, number> = { desktop: 0, mobile: 0, tablet: 0 };
    const countryCounts: Record<string, number> = {};
    const uniqueUsers = new Set<string>();
    const userDays = new Map<string, Set<string>>();
    let loginCount = 0;
    let appOpenCount = 0;

    const modeCounts: Record<string, number> = {};
    const modeUsers: Record<string, Set<string>> = {};
    const toolCounts: Record<string, number> = {};
    const toolUsers: Record<string, Set<string>> = {};

    const TOOL_EVENTS = new Set([
      'export', 'mockup_open', 'presets_open', 'tutorial_open',
      'tool_brush', 'tool_remove_bg', 'tool_registration_marks',
    ]);

    function parseMeta(ev: Record<string, unknown>): Record<string, unknown> {
      const m = ev.meta;
      if (!m) return {};
      if (typeof m === 'object') return m as Record<string, unknown>;
      if (typeof m === 'string') {
        try { return JSON.parse(m) as Record<string, unknown>; } catch { return {}; }
      }
      return {};
    }

    for (const ev of rangeEvents) {
      const day = String(ev.created_at ?? '').slice(0, 10);
      if (!dailyMap.has(day)) dailyMap.set(day, { logins: 0, opens: 0, unique: new Set() });
      const d = dailyMap.get(day)!;

      const email = String(ev.email ?? '').toLowerCase();
      const type = String(ev.event_type ?? '');
      if (email) {
        d.unique.add(email);
        uniqueUsers.add(email);
        if (!userDays.has(email)) userDays.set(email, new Set());
        userDays.get(email)!.add(day);
      }

      if (type === 'login') { d.logins++; loginCount++; }
      else if (type === 'app_open') { d.opens++; appOpenCount++; }
      else if (type === 'mode_change') {
        const meta = parseMeta(ev);
        const mode = String(meta.mode ?? 'unknown');
        modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
        if (email) {
          if (!modeUsers[mode]) modeUsers[mode] = new Set();
          modeUsers[mode].add(email);
        }
      } else if (TOOL_EVENTS.has(type)) {
        const meta = parseMeta(ev);
        const label = type === 'export'
          ? `export:${String(meta.format ?? 'file')}`
          : type === 'tutorial_open'
            ? `tutorial:${String(meta.kind ?? 'open')}`
            : type.replace(/^tool_/, '');
        toolCounts[label] = (toolCounts[label] ?? 0) + 1;
        if (email) {
          if (!toolUsers[label]) toolUsers[label] = new Set();
          toolUsers[label].add(email);
        }
      }

      const dt = String(ev.device_type ?? 'desktop');
      deviceCounts[dt] = (deviceCounts[dt] ?? 0) + 1;

      const cc = String(ev.country ?? 'Unknown');
      countryCounts[cc] = (countryCounts[cc] ?? 0) + 1;
    }

    // Fill gaps in daily timeline across the full selected range
    const dailyTrend: Array<{ date: string; logins: number; opens: number; unique: number; dau: number }> = [];
    const rangeStart = new Date(since); rangeStart.setUTCHours(0, 0, 0, 0);
    const rangeEnd   = new Date(until);
    for (let d = new Date(rangeStart); d <= rangeEnd; d.setUTCDate(d.getUTCDate() + 1)) {
      const key   = d.toISOString().slice(0, 10);
      const entry = dailyMap.get(key);
      const dau = entry?.unique.size ?? 0;
      dailyTrend.push({
        date: key,
        logins: entry?.logins ?? 0,
        opens: entry?.opens ?? 0,
        unique: dau,
        dau,
      });
    }

    const latestDau = dailyTrend.length ? dailyTrend[dailyTrend.length - 1].dau : 0;

    // Rolling WAU / MAU ending at `until`
    const wauUsers = new Set<string>();
    const mauUsers = new Set<string>();
    for (const ev of events) {
      const created = String(ev.created_at ?? '');
      const email = String(ev.email ?? '').toLowerCase();
      if (!email) continue;
      if (created >= wauSince && created <= until) wauUsers.add(email);
      if (created >= mauSince && created <= until) mauUsers.add(email);
    }

    let returningUsers = 0;
    for (const daysSet of userDays.values()) {
      if (daysSet.size >= 2) returningUsers++;
    }

    const modes = Object.entries(modeCounts)
      .map(([mode, count]) => ({ mode, count, uniqueUsers: modeUsers[mode]?.size ?? 0 }))
      .sort((a, b) => b.count - a.count);

    const tools = Object.entries(toolCounts)
      .map(([tool, count]) => ({ tool, count, uniqueUsers: toolUsers[tool]?.size ?? 0 }))
      .sort((a, b) => b.count - a.count);

    // Top 15 countries
    const topCountries = Object.entries(countryCounts)
      .filter(([k]) => k && k !== 'Unknown' && k !== 'null')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([country, count]) => ({ country, count }));

    // Peak hour analysis (UTC) — activity in selected range
    const hourCounts: number[] = new Array(24).fill(0);
    for (const ev of rangeEvents) {
      const hour = new Date(String(ev.created_at ?? '')).getUTCHours();
      if (!isNaN(hour)) hourCounts[hour]++;
    }
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

    // ── Subscription trend from daily snapshots ─────────────────────────────
    const subTrend = snapshots.map(s => ({
      date:      String(s.created_at ?? '').slice(0, 10),
      active:    Number(s.active   ?? 0),
      trial:     Number(s.trial    ?? 0),
      paused:    Number(s.paused   ?? 0),
      cancelled: Number(s.cancelled ?? 0),
      total:     Number(s.total    ?? 0),
    }));

    res.status(200).json({
      period: { days, since, until },
      summary: {
        totalEvents:  rangeEvents.length,
        loginCount,
        appOpenCount,
        uniqueUsers:  uniqueUsers.size,
        returningUsers,
        peakHour,
        dau: latestDau,
        wau: wauUsers.size,
        mau: mauUsers.size,
      },
      modes,
      tools,
      devices: deviceCounts,
      countries: topCountries,
      dailyTrend,
      hourly: hourCounts,
      subscriptions,
      subTrend,
    });
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
}
