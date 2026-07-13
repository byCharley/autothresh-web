import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const TESTER_EMAILS = new Set(
  (process.env.TESTER_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

const SUPABASE_URL  = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function detectDevice(ua: string): string {
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|opera mini|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function sbPost(table: string, data: Record<string, unknown>) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    body: JSON.stringify(data),
  }).catch(() => { /* non-blocking */ });
}

function logEvent(data: Record<string, unknown>) {
  sbPost('analytics_events', data);
}

async function getUserPrefs(email: string): Promise<{ accentColor?: string }> {
  if (!SUPABASE_URL || !SERVICE_KEY) return {};
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/user_preferences?email=eq.${encodeURIComponent(email)}&select=accent_color&limit=1`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    if (!r.ok) return {};
    const rows = await r.json() as Array<{ accent_color?: string }>;
    return rows.length ? { accentColor: rows[0].accent_color ?? undefined } : {};
  } catch { return {}; }
}

async function checkTesterStatus(email: string): Promise<'active' | 'paused' | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/testers?email=eq.${encodeURIComponent(email)}&select=status&limit=1`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    if (!r.ok) return null;
    const rows = await r.json() as Array<{ status: string }>;
    if (!rows.length) return null;
    return rows[0].status === 'paused' ? 'paused' : 'active';
  } catch { return null; }
}

async function checkSecurityFlag(email: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/security_flags?email=eq.${encodeURIComponent(email.toLowerCase())}&expired=eq.true&select=email`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    if (!r.ok) return false;
    const rows = await r.json() as unknown[];
    return rows.length > 0;
  } catch { return false; }
}

function runFraudCheck(email: string, ip: string, firstName: string, subscriptionStatus: string) {
  if (!ip || !SUPABASE_URL || !SERVICE_KEY) return;
  // Only check trial accounts — no point flagging active paid subscribers
  if (subscriptionStatus !== 'trial') return;

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  fetch(
    `${SUPABASE_URL}/rest/v1/security_events?ip=eq.${encodeURIComponent(ip)}&subscription_status=eq.trial&created_at=gte.${since}&select=email,first_name&limit=50`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  ).then(r => r.json()).then((rows: Array<{ email: string; first_name: string }>) => {
    const others = rows.filter(r => r.email.toLowerCase() !== email.toLowerCase());
    if (!others.length) return;

    const nameMatch = others.some(r =>
      r.first_name && firstName && r.first_name.toLowerCase() === firstName.toLowerCase()
    );
    const confidence = nameMatch ? 'high' : 'low';
    const relatedEmails = [...new Set(others.map(r => r.email.toLowerCase()))];
    const reason = nameMatch
      ? `Same IP and first name as ${relatedEmails.length} other trial account(s): ${relatedEmails.join(', ')}`
      : `Same IP as ${relatedEmails.length} other trial account(s): ${relatedEmails.join(', ')}`;

    // Upsert flag (insert if not exists, skip if already flagged)
    fetch(`${SUPABASE_URL}/rest/v1/security_flags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        email: email.toLowerCase(),
        ip,
        first_name: firstName,
        related_emails: relatedEmails,
        reason,
        confidence,
        auto_flagged: true,
        reviewed: false,
        expired: true,
      }),
    }).catch(() => {});
  }).catch(() => {});
}

const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN!;
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const LDT_ACCESS   = process.env.LDT_ACCESS ?? '';
const LDT_API_URL  = 'https://digital.ldtsoft.work/api/integrate';

async function checkLdtLicense(email: string): Promise<boolean> {
  if (!LDT_ACCESS) return false;
  try {
    const url = `${LDT_API_URL}/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=20`;
    console.log('LDT request:', url);
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${LDT_ACCESS}` } });
    const rawText = await r.text();
    console.log('LDT HTTP status:', r.status, 'body:', rawText.slice(0, 300));
    if (!r.ok) return false;
    const raw = JSON.parse(rawText) as unknown;
    let orders: unknown[] = [];
    if (Array.isArray(raw)) {
      orders = raw;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      for (const key of ['data', 'orders', 'items', 'result', 'list']) {
        if (Array.isArray(obj[key])) { orders = obj[key] as unknown[]; break; }
      }
    }
    console.log('LDT orders found:', orders.length);
    // Only count orders specifically for AutoThresh Web (not Pro, Lite, etc.)
    const isWebOrder = (o: unknown) => {
      const json = JSON.stringify(o).toLowerCase().replace(/™/g, '');
      // Must contain 'autothresh web' but NOT be a different product
      return json.includes('autothresh web') && !json.includes('autothresh pro') && !json.includes('autothresh lite');
    };
    const matched = orders.filter(isWebOrder);
    console.log('LDT AutoThresh Web orders:', matched.length);
    return matched.length > 0;
  } catch (e) {
    console.error('LDT check error:', e);
    return false;
  }
}


async function sealCheckSubscription(email: string): Promise<{ hasSub: boolean; activeSubs: number; subscriptionStatus?: string; nextBillingDate?: string; planTitle?: string }> {
  try {
    const url = `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`;
    console.log('Seal request:', url, 'token present:', !!SEAL_TOKEN);

    const r = await fetch(url, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
    const rawText = await r.text();
    console.log('Seal HTTP status:', r.status);
    console.log('Seal raw response:', rawText.slice(0, 800));

    if (!r.ok) return { hasSub: false, activeSubs: 0 };

    const raw = JSON.parse(rawText) as unknown;

    // Extract subscription array — Seal wraps in { payload: { subscriptions: [...] } }
    let subs: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) {
      subs = raw as Array<Record<string, unknown>>;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload && Array.isArray(payload.subscriptions)) {
        subs = payload.subscriptions as Array<Record<string, unknown>>;
      } else {
        for (const key of ['subscriptions', 'data', 'result', 'subscription_contracts']) {
          if (Array.isArray(obj[key])) { subs = obj[key] as Array<Record<string, unknown>>; break; }
        }
      }
    }

    console.log('Seal parsed subs count:', subs.length);
    if (subs[0]) console.log('Seal sub[0] keys:', JSON.stringify(subs[0]));

    let nextBillingDate: string | undefined;
    let planTitle: string | undefined;
    let subscriptionStatus: string | undefined;
    let hasSub = false;
    let activeSubs = 0;
    const TRIAL_DAYS = parseInt(process.env.SEAL_TRIAL_DAYS ?? '3');

    for (const s of subs) {
      const st = String(s.status ?? '').toUpperCase();

      // Seal uses subscription_type=2 for trials; infer end date from order_placed + TRIAL_DAYS
      const trialEndExplicit = (s.trial_end_date ?? s.trial_ends_on ?? s.free_trial_end_date ?? s.trial_end ?? s.free_trial_end ?? s.trial_ends_at) as string | undefined;
      const isTrialType = Number(s.subscription_type) === 2;
      const orderPlaced = s.order_placed as string | undefined;
      const trialEndInferred = isTrialType && orderPlaced
        ? new Date(new Date(orderPlaced).getTime() + TRIAL_DAYS * 86_400_000).toISOString()
        : undefined;
      const trialEndRaw = trialEndExplicit ?? trialEndInferred;
      const trialStillActive = !!trialEndRaw && new Date(trialEndRaw) > new Date();

      // TRIAL is only valid if the trial window hasn't closed yet (failsafe if Seal is slow to update status)
      const valid = st === 'ACTIVE' || (st === 'TRIAL' && trialStillActive);
      const isInTrial = st === 'TRIAL' || (st === 'ACTIVE' && trialStillActive);

      // Seal nests plan name inside items array
      const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
      const itemPlanName = items[0]?.selling_plan_name ?? items[0]?.title;

      if (valid) {
        activeSubs++;
        hasSub = true;
        if (!subscriptionStatus) {
          subscriptionStatus = (isInTrial && (st === 'ACTIVE' || st === 'TRIAL')) ? 'trial' : st.toLowerCase();
          nextBillingDate = isInTrial
            ? trialEndRaw
            : (s.next_billing_date ?? s.next_charge_scheduled_at ?? s.next_charge_at ?? s.nextBillingDate ?? s.billing_date) as string | undefined;
          planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? itemPlanName) as string | undefined;
        }
      }
    }
    return { hasSub, activeSubs, subscriptionStatus, nextBillingDate, planTitle };
  } catch (e) {
    console.error('Seal check error:', e);
    return { hasSub: false, activeSubs: 0 };
  }
}

function flagDuplicateSubs(email: string, ip: string, count: number) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/security_flags`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Prefer': 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({
      email,
      ip: ip || null,
      reason: `Duplicate subscriptions detected: ${count} active Seal subscriptions on same account — review for duplicate charge`,
      confidence: 'high',
      auto_flagged: true,
      reviewed: false,
      expired: false,
    }),
  }).catch(() => {});
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ valid: false, error: 'Token required' });

  const clientIp = String(
    req.headers['x-real-ip'] ??
    req.headers['x-forwarded-for']?.toString().split(',')[0] ??
    ''
  ).trim();

  // ── Validate token + get customer info ────────────────────────────────────
  let custData: { data?: Record<string, unknown>; errors?: unknown[] } = {};
  let rawCust = '';
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({
        query: `query { customer { firstName emailAddress { emailAddress } } }`,
      }),
    });
    rawCust = await r.text();
    custData = JSON.parse(rawCust);
  } catch (e) {
    console.error('verify customerApiQuery error:', e, 'raw:', rawCust.slice(0, 200));
    return res.status(200).json({ valid: false });
  }

  type CustNode = { firstName?: string; emailAddress?: { emailAddress: string } };
  const cust = (custData.data as { customer?: CustNode })?.customer;
  console.log('verify customer:', JSON.stringify({ hasCust: !!cust, errors: custData.errors }));
  if (!cust) return res.status(200).json({ valid: false });

  const email = cust.emailAddress?.emailAddress ?? '';
  const emailLower = email.toLowerCase();
  const isCreator = CREATOR_EMAILS.has(emailLower);

  // ── Run all async checks in parallel ─────────────────────────────────────
  const [sealResult, ldtResult, testerStatus, securityResult, userPrefs] = await Promise.all([
    sealCheckSubscription(email),
    (!isCreator) ? checkLdtLicense(emailLower) : Promise.resolve(false),
    (!isCreator) ? checkTesterStatus(emailLower) : Promise.resolve<'active' | 'paused' | null>(null),
    (!isCreator) ? checkSecurityFlag(emailLower) : Promise.resolve(false),
    getUserPrefs(emailLower),
  ]);

  const { hasSub, activeSubs, subscriptionStatus, nextBillingDate, planTitle } = sealResult;
  const hasLifetime = ldtResult;
  const isSecurityExpired = securityResult;

  // Testers: env var OR active DB record. Paused DB record → no access.
  const envTester = !isCreator && TESTER_EMAILS.has(emailLower);
  const isTester  = envTester || (!isCreator && testerStatus === 'active');

  const finalHasSub = hasSub || isCreator || isTester || hasLifetime;

  const finalStatus   = isCreator ? 'creator' : isTester ? 'tester' : hasLifetime ? 'lifetime' : subscriptionStatus;
  const finalPlan     = isCreator ? 'Creator' : isTester ? 'Tester Access' : hasLifetime ? 'Lifetime' : planTitle;
  const finalExpiry   = (isCreator || isTester || hasLifetime) ? undefined : nextBillingDate;

  console.log('Verify result:', { email, hasSub, isCreator, isTester, testerStatus, finalHasSub, finalStatus, nextBillingDate, planTitle });

  // ── Log analytics + security events (fire-and-forget) ────────────────────
  const ua = String(req.headers['user-agent'] ?? '');
  const country = String(req.headers['x-vercel-ip-country'] ?? req.headers['x-vercel-ip-country-region'] ?? '');
  const city    = req.headers['x-vercel-ip-city'] ? decodeURIComponent(String(req.headers['x-vercel-ip-city'])) : '';

  logEvent({
    event_type:  'app_open',
    email:       emailLower,
    device_type: detectDevice(ua),
    country:     country || null,
    city:        city || null,
  });

  sbPost('security_events', {
    email:                emailLower,
    ip:                   clientIp || null,
    first_name:           cust.firstName ?? '',
    subscription_status:  finalStatus ?? 'none',
    country:              country || null,
    city:                 city || null,
  });

  if (!isCreator && !isTester) {
    runFraudCheck(emailLower, clientIp, cust.firstName ?? '', finalStatus ?? '');
    if (activeSubs > 1) {
      flagDuplicateSubs(emailLower, clientIp, activeSubs);
    }
  }

  if (isSecurityExpired) {
    return res.status(200).json({
      valid:              true,
      hasSubscription:    false,
      subscriptionStatus: 'blocked',
      email,
      firstName:          cust.firstName ?? '',
      accentColor:        userPrefs.accentColor,
    });
  }

  return res.status(200).json({
    valid:                 true,
    hasSubscription:       finalHasSub,
    subscriptionStatus:    finalStatus,
    subscriptionExpiresAt: finalExpiry,
    planTitle:             finalPlan,
    email,
    firstName:             cust.firstName ?? '',
    accentColor:           userPrefs.accentColor,
  });
}
