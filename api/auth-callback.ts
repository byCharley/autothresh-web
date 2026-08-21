import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLIENT_ID    = process.env.customer!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';

const TESTER_EMAILS = new Set(
  (process.env.TESTER_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

const SUPABASE_URL  = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function detectDevice(ua: string): string {
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|opera mini|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function sbPost(table: string, data: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY },
    body: JSON.stringify(data),
  }).catch(() => { /* non-blocking */ });
}

function logEvent(data: Record<string, unknown>) {
  sbPost('analytics_events', data);
}

async function checkSecurityFlag(email: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/security_flags?email=eq.${encodeURIComponent(email.toLowerCase())}&expired=eq.true&select=email`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY } }
    );
    if (!r.ok) return false;
    const rows = await r.json() as unknown[];
    return rows.length > 0;
  } catch { return false; }
}

function runFraudCheck(email: string, ip: string, firstName: string, subscriptionStatus: string) {
  if (!ip || !SUPABASE_URL || !SUPABASE_KEY) return;
  if (subscriptionStatus !== 'trial') return;

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  fetch(
    `${SUPABASE_URL}/rest/v1/security_events?ip=eq.${encodeURIComponent(ip)}&subscription_status=eq.trial&created_at=gte.${since}&select=email,first_name&limit=50`,
    { headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY } }
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

    fetch(`${SUPABASE_URL}/rest/v1/security_flags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
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

// Customer Account API
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const LDT_ACCESS   = process.env.LDT_ACCESS ?? '';
const LDT_API_URL  = 'https://digital.ldtsoft.work/api/integrate';

interface SealCheck {
  hasSub: boolean;
  activeSubs: number;
  everInSeal: boolean;
  subscriptionStatus?: string;
  nextBillingDate?: string;
  planTitle?: string;
}
interface TesterRecord { status: 'active' | 'paused'; role: string }
interface Membership {
  hasSubscription: boolean;
  subscriptionStatus?: string;
  planTitle?: string;
  subscriptionExpiresAt?: string;
  isTester: boolean;
  hasLifetime: boolean;
}

function sealBlob(s: Record<string, unknown>): string {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  return [
    s.billing_interval, s.interval, s.delivery_interval,
    s.plan_title, s.product_title, s.plan_name, s.selling_plan_name,
    items[0]?.selling_plan_name, items[0]?.title, items[0]?.product_title,
  ].filter(Boolean).join(' ').toLowerCase();
}

function sealItemPlan(s: Record<string, unknown>): unknown {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  return items[0]?.selling_plan_name ?? items[0]?.title;
}

async function checkLdtLifetime(email: string): Promise<boolean> {
  if (!LDT_ACCESS) return false;
  try {
    const r = await fetch(`${LDT_API_URL}/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=20`, {
      headers: { 'LDT-X-Access-Token': LDT_ACCESS },
    });
    if (!r.ok) return false;
    const raw = JSON.parse(await r.text()) as unknown;
    let orders: unknown[] = [];
    if (Array.isArray(raw)) orders = raw;
    else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      for (const key of ['data', 'orders', 'items', 'result', 'list']) {
        if (Array.isArray(obj[key])) { orders = obj[key] as unknown[]; break; }
      }
    }
    const isLifetimeWebOrder = (o: unknown) => {
      const json = JSON.stringify(o).toLowerCase().replace(/™/g, '');
      if (!json.includes('autothresh web')) return false;
      if (json.includes('autothresh pro') || json.includes('autothresh lite')) return false;
      return /\blifetime\b/.test(json) && !json.includes('monthly') && !json.includes('annual') && !json.includes('yearly');
    };
    return orders.filter(isLifetimeWebOrder).length > 0;
  } catch { return false; }
}

async function sealCheckSubscription(email: string): Promise<SealCheck> {
  try {
    const r = await fetch(`${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`, {
      headers: { 'X-Seal-Token': SEAL_TOKEN },
    });
    const rawText = await r.text();
    console.log('Seal HTTP status:', r.status);
    if (!r.ok) return { hasSub: false, activeSubs: 0, everInSeal: false };

    const raw = JSON.parse(rawText) as unknown;
    let subs: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) subs = raw as Array<Record<string, unknown>>;
    else if (raw && typeof raw === 'object') {
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

    let nextBillingDate: string | undefined;
    let planTitle: string | undefined;
    let subscriptionStatus: string | undefined;
    let hasSub = false;
    let activeSubs = 0;
    const everInSeal = subs.length > 0;
    const TRIAL_DAYS = parseInt(process.env.SEAL_TRIAL_DAYS ?? '3', 10);

    for (const s of subs) {
      const st = String(s.status ?? '').toUpperCase();
      const isMonthly = sealBlob(s).includes('month');
      const trialEndExplicit = (s.trial_end_date ?? s.trial_ends_on ?? s.free_trial_end_date ?? s.trial_end ?? s.free_trial_end ?? s.trial_ends_at) as string | undefined;
      const isTrialType = Number(s.subscription_type) === 2 && !isMonthly;
      const orderPlaced = s.order_placed as string | undefined;
      const trialEndInferred = isTrialType && orderPlaced
        ? new Date(new Date(orderPlaced).getTime() + TRIAL_DAYS * 86_400_000).toISOString()
        : undefined;
      const trialEndRaw = trialEndExplicit ?? trialEndInferred;
      const trialStillActive = !!trialEndRaw && new Date(trialEndRaw) > new Date();
      const valid = st === 'ACTIVE' || st === 'TRIAL';
      const isInTrial = !isMonthly && (st === 'TRIAL' || (st === 'ACTIVE' && trialStillActive) || (isTrialType && trialStillActive));

      if (valid) {
        activeSubs++;
        hasSub = true;
        if (!subscriptionStatus) {
          subscriptionStatus = isInTrial ? 'trial' : 'active';
          nextBillingDate = isInTrial
            ? (trialEndRaw ?? (s.next_billing_date as string | undefined))
            : (s.next_billing_date ?? s.next_charge_scheduled_at ?? s.next_charge_at ?? s.nextBillingDate ?? s.billing_date) as string | undefined;
          planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? sealItemPlan(s)) as string | undefined;
        }
      }
    }
    if (!hasSub) {
      for (const s of subs) {
        const st = String(s.status ?? '').toUpperCase();
        if (st !== 'PAUSED') continue;
        subscriptionStatus = 'paused';
        planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? sealItemPlan(s)) as string | undefined;
        nextBillingDate = (s.next_billing_date ?? s.next_charge_scheduled_at ?? s.next_charge_at) as string | undefined;
        break;
      }
      if (!subscriptionStatus) {
        for (const s of subs) {
          const st = String(s.status ?? '').toUpperCase();
          if (st === 'CANCELLED' || st === 'CANCELED') { subscriptionStatus = 'cancelled'; break; }
        }
      }
    }
    return { hasSub, activeSubs, everInSeal, subscriptionStatus, nextBillingDate, planTitle };
  } catch (e) {
    console.error('Seal check error:', e);
    return { hasSub: false, activeSubs: 0, everInSeal: false };
  }
}

async function checkTesterStatus(email: string): Promise<TesterRecord | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/testers?email=eq.${encodeURIComponent(email)}&select=status,role&limit=1`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY } }
    );
    if (!r.ok) return null;
    const rows = await r.json() as Array<{ status: string; role?: string }>;
    if (!rows.length) return null;
    return { status: rows[0].status === 'paused' ? 'paused' : 'active', role: rows[0].role ?? 'tester' };
  } catch { return null; }
}

function resolveMembership(opts: {
  isCreator: boolean;
  envTester: boolean;
  testerRecord: TesterRecord | null;
  ldtLifetime: boolean;
  seal: SealCheck;
}): Membership {
  const { isCreator, envTester, testerRecord, ldtLifetime, seal } = opts;
  const isTester = envTester || (!isCreator && testerRecord?.status === 'active' && testerRecord.role !== 'lifetime');
  const hasManualLifetime = !isCreator && testerRecord?.status === 'active' && testerRecord.role === 'lifetime';
  const liveSeal = seal.hasSub || seal.subscriptionStatus === 'paused';
  const hasLifetime = !liveSeal && (ldtLifetime || hasManualLifetime);

  if (isCreator) {
    return { hasSubscription: true, subscriptionStatus: 'creator', planTitle: 'Creator', isTester: false, hasLifetime: false };
  }
  if (liveSeal) {
    return {
      hasSubscription: seal.hasSub || seal.subscriptionStatus === 'paused',
      subscriptionStatus: seal.subscriptionStatus,
      planTitle: seal.planTitle,
      subscriptionExpiresAt: seal.nextBillingDate,
      isTester,
      hasLifetime: false,
    };
  }
  if (isTester) {
    return { hasSubscription: true, subscriptionStatus: 'tester', planTitle: 'Tester Access', isTester: true, hasLifetime: false };
  }
  if (hasLifetime) {
    return { hasSubscription: true, subscriptionStatus: 'lifetime', planTitle: 'Lifetime Access', isTester: false, hasLifetime: true };
  }
  return {
    hasSubscription: false,
    subscriptionStatus: seal.subscriptionStatus,
    planTitle: seal.planTitle,
    subscriptionExpiresAt: seal.nextBillingDate,
    isTester: false,
    hasLifetime: false,
  };
}

function flagDuplicateSubs(email: string, ip: string, count: number) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/security_flags`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
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

  const clientIp = String(
    req.headers['x-real-ip'] ??
    req.headers['x-forwarded-for']?.toString().split(',')[0] ??
    ''
  ).trim();

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

  let tokens: { access_token?: string; id_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
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

  // ── 4. Check subscription, tester status, and security in parallel ────────
  const emailLower = custEmail.toLowerCase();
  const isCreator  = CREATOR_EMAILS.has(emailLower);

  const [sealResult, ldtLifetime, testerRecord, isSecurityExpired] = await Promise.all([
    sealCheckSubscription(custEmail),
    (!isCreator) ? checkLdtLifetime(emailLower) : Promise.resolve(false),
    (!isCreator) ? checkTesterStatus(emailLower) : Promise.resolve(null),
    (!isCreator) ? checkSecurityFlag(emailLower) : Promise.resolve(false),
  ]);

  const envTester = !isCreator && TESTER_EMAILS.has(emailLower);
  const membership = resolveMembership({
    isCreator,
    envTester,
    testerRecord,
    ldtLifetime,
    seal: sealResult,
  });

  const { activeSubs } = sealResult;
  const isTester = membership.isTester;
  const finalHasSub = membership.hasSubscription;
  const finalStatus = membership.subscriptionStatus;
  const finalPlan = membership.planTitle;
  const finalExpiry = membership.subscriptionExpiresAt;

  console.log('Auth result:', { custEmail, hasSub: sealResult.hasSub, isCreator, isTester, testerRecord, ldtLifetime, finalHasSub, finalStatus, planTitle: finalPlan });

  // ── Log login + security events (fire-and-forget) ────────────────────────
  const ua = String(req.headers['user-agent'] ?? '');
  const country = String(req.headers['x-vercel-ip-country'] ?? '');
  const city    = req.headers['x-vercel-ip-city'] ? decodeURIComponent(String(req.headers['x-vercel-ip-city'])) : '';

  logEvent({
    event_type:  'login',
    email:       emailLower,
    device_type: detectDevice(ua),
    country:     country || null,
    city:        city || null,
  });

  sbPost('security_events', {
    email:                emailLower,
    ip:                   clientIp || null,
    first_name:           firstName,
    subscription_status:  finalStatus ?? 'none',
    country:              country || null,
    city:                 city || null,
  });

  if (!isCreator && !isTester) {
    runFraudCheck(emailLower, clientIp, firstName, finalStatus ?? '');
    if (activeSubs > 1) {
      flagDuplicateSubs(emailLower, clientIp, activeSubs);
    }
  }

  if (isSecurityExpired) {
    return res.status(200).json({
      token:             tokens.access_token,
      idToken:           tokens.id_token,
      refreshToken:      tokens.refresh_token,
      expiresAt,
      email:             custEmail,
      firstName,
      hasSubscription:   false,
      subscriptionStatus: 'blocked',
      planTitle:         undefined,
    });
  }

  return res.status(200).json({
    token:                tokens.access_token,
    idToken:              tokens.id_token,
    refreshToken:         tokens.refresh_token,
    expiresAt,
    email:                custEmail,
    firstName,
    hasSubscription:      finalHasSub,
    subscriptionStatus:   finalStatus,
    subscriptionExpiresAt: finalExpiry,
    planTitle:            finalPlan,
  });
}
