import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';

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

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const LDT_ACCESS   = process.env.LDT_ACCESS ?? '';
const LDT_API_URL  = 'https://digital.ldtsoft.work/api/integrate';

interface SealCheck {
  hasSub: boolean;
  hasLifetime: boolean;
  activeSubs: number;
  everInSeal: boolean;
  subscriptionStatus?: string;
  nextBillingDate?: string;
  planTitle?: string;
}
interface LdtCheck { lifetime: boolean; webOrder: boolean }
interface TesterRecord { status: 'active' | 'paused'; role: string }
interface Membership {
  hasSubscription: boolean;
  subscriptionStatus?: string;
  planTitle?: string;
  subscriptionExpiresAt?: string;
  isTester: boolean;
  hasLifetime: boolean;
}

function looksLikeOneTimePlan(text: string): boolean {
  const t = String(text ?? '').toLowerCase();
  return /one[\s_-]*time/.test(t) || /\blifetime\b/.test(t);
}

function looksLikeRecurringTitle(text: string): boolean {
  const t = String(text ?? '').toLowerCase();
  if (looksLikeOneTimePlan(t)) return false;
  return t.includes('monthly') || t.includes('annual') || t.includes('yearly') || /\bsubscribe\b/.test(t) || t.includes('free trial');
}

const LIFETIME_MIN_PAID = 80;

function parseMoney(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof v === 'object' && 'amount' in (v as object)) {
    return parseMoney((v as { amount: unknown }).amount);
  }
  return 0;
}

function toUsd(n: number): number {
  if (n >= 1000) return n / 100;
  return n;
}

function collectMoney(o: unknown): number {
  let max = 0;
  const walk = (v: unknown, key: string) => {
    if (v == null) return;
    const k = key.toLowerCase();
    const moneyKey = /(price|total|amount|paid|subtotal|grand|cost)/.test(k)
      && !/(page|count|qty|quantity|id$|interval|type)/.test(k);
    if (moneyKey) {
      const usd = toUsd(parseMoney(v));
      if (usd > max && usd < 10_000) max = usd;
    }
    if (Array.isArray(v)) { v.forEach(item => walk(item, key)); return; }
    if (typeof v === 'object') {
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) walk(cv, ck);
    }
  };
  walk(o, '');
  return max;
}

function isPaidLifetime(o: unknown, titles: string): boolean {
  if (!isAutothreshWebText(titles)) return false;
  if (looksLikeRecurringTitle(titles)) return false;
  if (looksLikeOneTimePlan(titles)) return true;
  return collectMoney(o) > LIFETIME_MIN_PAID;
}

function isAutothreshWebText(text: string): boolean {
  const t = String(text ?? '').toLowerCase().replace(/™/g, '').replace(/[–—]/g, '-');
  if (t.includes('autothresh pro') || t.includes('autothresh lite')) return false;
  return t.includes('autothresh web') || t.includes('autothresh-web') || t.includes('autothreshweb');
}

function collectPlanText(o: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (v == null) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const k = key.toLowerCase();
      const named =
        k === 'title' || k === 'name' || k === 'sku' || k === 'handle' ||
        k.includes('selling_plan') || k.includes('sellingplan') ||
        k.includes('variant') || k.includes('plan_name') || k.includes('planname') ||
        k.includes('plan_title') || k.includes('plantitle') ||
        k.includes('product_title') || k.includes('producttitle') ||
        k.includes('internal_name') || k.includes('internalname') ||
        k === 'product' || k === 'product_name' || k === 'productname';
      if (named) parts.push(String(v));
      return;
    }
    if (Array.isArray(v)) { v.forEach(item => walk(item, key)); return; }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, k);
    }
  };
  walk(o, '');
  return parts.join(' ').toLowerCase();
}

function orderLooksLikeLifetime(o: unknown): boolean {
  return isPaidLifetime(o, collectPlanText(o));
}

function collectEmails(o: unknown): string[] {
  const emails: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (v == null) return;
    if (typeof v === 'string') {
      if (v.includes('@') && key.toLowerCase().includes('email')) emails.push(v.toLowerCase().trim());
      return;
    }
    if (Array.isArray(v)) { v.forEach(item => walk(item, key)); return; }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, k);
    }
  };
  walk(o, '');
  return emails;
}

function ldtOrderBelongsToEmail(o: unknown, email: string): boolean {
  const emails = collectEmails(o);
  if (!emails.length) return true;
  return emails.includes(email.toLowerCase());
}

function extractLdtOrders(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw.filter(item => item && typeof item === 'object' && !Array.isArray(item));
  }
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  for (const key of ['data', 'orders', 'items', 'result', 'list', 'payload', 'records', 'digital_orders', 'orderList']) {
    const nested = extractLdtOrders(obj[key]);
    if (nested.length) return nested;
  }
  return [];
}

function sealBlob(s: Record<string, unknown>): string {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  return [
    s.billing_interval, s.interval, s.delivery_interval,
    s.plan_title, s.product_title, s.plan_name, s.selling_plan_name, s.name, s.internal_name,
    ...items.map(i => [i.selling_plan_name, i.title, i.product_title, i.variant_title, i.name].filter(Boolean).join(' ')),
  ].filter(Boolean).join(' ').toLowerCase();
}

function sealItemPlan(s: Record<string, unknown>): unknown {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  return items[0]?.selling_plan_name ?? items[0]?.title;
}

function isSealOneTimePurchase(s: Record<string, unknown>): boolean {
  return isPaidLifetime(s, `${sealBlob(s)} ${collectPlanText(s)}`);
}

async function checkLdtLifetime(email: string): Promise<LdtCheck> {
  if (!LDT_ACCESS) return { lifetime: false, webOrder: false };
  try {
    const r = await fetch(`${LDT_API_URL}/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=50`, {
      headers: { 'LDT-X-Access-Token': LDT_ACCESS },
    });
    const rawText = await r.text();
    console.log('LDT HTTP status:', r.status, 'body:', rawText.slice(0, 400));
    if (!r.ok) return { lifetime: false, webOrder: false };
    const orders = extractLdtOrders(JSON.parse(rawText) as unknown)
      .filter(o => ldtOrderBelongsToEmail(o, email));
    const webOrders = orders.filter(o => isAutothreshWebText(collectPlanText(o)));
    const lifetimeOrders = webOrders.filter(orderLooksLikeLifetime);
    console.log('LDT orders:', orders.length, 'web:', webOrders.length, 'lifetime:', lifetimeOrders.length, 'paid:', collectMoney(webOrders[0] ?? {}), 'titles:', collectPlanText(webOrders[0] ?? {}).slice(0, 200));
    return { lifetime: lifetimeOrders.length > 0, webOrder: webOrders.length > 0 };
  } catch (e) {
    console.error('LDT check error:', e);
    return { lifetime: false, webOrder: false };
  }
}

async function checkShopifyLifetime(token: string): Promise<boolean> {
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({
        query: `query { customer { orders(first: 25) { nodes { name totalPrice { amount } lineItems(first: 20) { nodes { name title variantTitle sku currentTotalPrice { amount } originalTotalPrice { amount } } } } } } }`,
      }),
    });
    const body = await r.json() as {
      data?: { customer?: { orders?: { nodes?: Array<{ name?: string; totalPrice?: { amount?: string }; lineItems?: { nodes?: Array<Record<string, unknown>> } }> } } };
      errors?: unknown;
    };
    if (body.errors) {
      console.log('Shopify orders query errors:', JSON.stringify(body.errors).slice(0, 400));
      return false;
    }
    const orders = body.data?.customer?.orders?.nodes ?? [];
    const titles: string[] = [];
    let lifetime = false;
    for (const order of orders) {
      const orderTotal = parseMoney(order.totalPrice);
      for (const item of order.lineItems?.nodes ?? []) {
        const text = [item.name, item.title, item.variantTitle, item.sku].filter(Boolean).join(' ');
        titles.push(text);
        if (!isAutothreshWebText(text) || looksLikeRecurringTitle(text)) continue;
        const itemPaid = parseMoney(item.currentTotalPrice) || parseMoney(item.originalTotalPrice) || orderTotal;
        if (looksLikeOneTimePlan(text) || itemPaid > LIFETIME_MIN_PAID) lifetime = true;
      }
    }
    console.log('Shopify orders:', orders.length, 'lifetime:', lifetime, 'titles:', titles.slice(0, 10));
    return lifetime;
  } catch (e) {
    console.error('Shopify lifetime order check error:', e);
    return false;
  }
}

async function sealCheckSubscription(email: string): Promise<SealCheck> {
  try {
    const r = await fetch(`${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}&with-items=true`, {
      headers: { 'X-Seal-Token': SEAL_TOKEN },
    });
    const rawText = await r.text();
    console.log('Seal HTTP status:', r.status);
    console.log('Seal raw response:', rawText.slice(0, 800));
    if (!r.ok) return { hasSub: false, hasLifetime: false, activeSubs: 0, everInSeal: false };

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
    let hasLifetime = false;
    let activeSubs = 0;
    const everInSeal = subs.length > 0;
    const TRIAL_DAYS = parseInt(process.env.SEAL_TRIAL_DAYS ?? '3', 10);

    for (const s of subs) {
      if (isSealOneTimePurchase(s)) {
        hasLifetime = true;
        continue;
      }
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
        if (isSealOneTimePurchase(s)) continue;
        const st = String(s.status ?? '').toUpperCase();
        if (st !== 'PAUSED') continue;
        subscriptionStatus = 'paused';
        planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? sealItemPlan(s)) as string | undefined;
        nextBillingDate = (s.next_billing_date ?? s.next_charge_scheduled_at ?? s.next_charge_at) as string | undefined;
        break;
      }
      if (!subscriptionStatus) {
        for (const s of subs) {
          if (isSealOneTimePurchase(s)) continue;
          const st = String(s.status ?? '').toUpperCase();
          if (st === 'CANCELLED' || st === 'CANCELED') {
            subscriptionStatus = 'cancelled';
            planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? sealItemPlan(s)) as string | undefined;
            break;
          }
        }
      }
    }
    return { hasSub, hasLifetime, activeSubs, everInSeal, subscriptionStatus, nextBillingDate, planTitle };
  } catch (e) {
    console.error('Seal check error:', e);
    return { hasSub: false, hasLifetime: false, activeSubs: 0, everInSeal: false };
  }
}

async function checkTesterStatus(email: string): Promise<TesterRecord | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/testers?email=eq.${encodeURIComponent(email)}&select=status,role&limit=1`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
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
  ldtWebOrder: boolean;
  seal: SealCheck;
}): Membership {
  const { isCreator, envTester, testerRecord, ldtLifetime, seal } = opts;
  const isTester = envTester || (!isCreator && testerRecord?.status === 'active' && testerRecord.role !== 'lifetime');
  const hasManualLifetime = !isCreator && testerRecord?.status === 'active' && testerRecord.role === 'lifetime';
  const liveSeal = seal.hasSub || seal.subscriptionStatus === 'paused';
  const hasLifetime = !liveSeal && (seal.hasLifetime || ldtLifetime || hasManualLifetime);

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

const DEVICE_CAP = 2;
const LICENSE_SECRET = process.env.LICENSE_TOKEN_SECRET || SERVICE_KEY || 'at-license';

interface LicenseDevice {
  id: string;
  device_id: string;
  device_name: string;
  last_seen_at: string;
  created_at: string;
}

function readLicenseToken(token: string): { email: string; licenseKey: string; orderNumber: string } | null {
  if (!token.startsWith('atlic.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', LICENSE_SECRET).update(parts[1]).digest('base64url');
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { email?: string; licenseKey?: string; orderNumber?: string; exp?: number };
    if (!data.exp || data.exp < Date.now() || !data.email || !data.licenseKey) return null;
    return { email: data.email, licenseKey: data.licenseKey, orderNumber: data.orderNumber ?? '' };
  } catch { return null; }
}

async function loadLicenseDevices(email: string, licenseKey?: string): Promise<LicenseDevice[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [];
  const filters = [`email=eq.${encodeURIComponent(email)}`];
  if (licenseKey) filters.push(`license_key=eq.${encodeURIComponent(licenseKey)}`);
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/license_devices?or=(${filters.join(',')})&select=id,device_id,device_name,last_seen_at,created_at&order=last_seen_at.desc`,
    { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } },
  );
  if (!r.ok) return [];
  return await r.json() as LicenseDevice[];
}

async function claimDevice(opts: {
  email: string;
  licenseKey?: string;
  orderNumber?: string;
  deviceId: string;
  deviceName: string;
  userAgent: string;
}): Promise<{ ok: boolean; devices: LicenseDevice[] }> {
  const { email, licenseKey, orderNumber, deviceId, deviceName, userAgent } = opts;
  if (!deviceId) return { ok: true, devices: [] };
  const devices = await loadLicenseDevices(email, licenseKey);
  const existing = devices.find(d => d.device_id === deviceId);
  if (existing) {
    fetch(`${SUPABASE_URL}/rest/v1/license_devices?device_id=eq.${encodeURIComponent(deviceId)}&email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
      body: JSON.stringify({ last_seen_at: new Date().toISOString(), device_name: deviceName || existing.device_name, user_agent: userAgent }),
    }).catch(() => {});
    return { ok: true, devices };
  }
  if (devices.length >= DEVICE_CAP) return { ok: false, devices };
  fetch(`${SUPABASE_URL}/rest/v1/license_devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    body: JSON.stringify({
      email, license_key: licenseKey || null, order_number: orderNumber || null,
      device_id: deviceId, device_name: deviceName || 'Device', user_agent: userAgent,
    }),
  }).catch(() => {});
  return { ok: true, devices: [...devices, { id: '', device_id: deviceId, device_name: deviceName, last_seen_at: new Date().toISOString(), created_at: new Date().toISOString() }] };
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

  const { token, deviceId, deviceName } = req.body as { token?: string; deviceId?: string; deviceName?: string };
  if (!token) return res.status(400).json({ valid: false, error: 'Token required' });

  const clientIp = String(
    req.headers['x-real-ip'] ??
    req.headers['x-forwarded-for']?.toString().split(',')[0] ??
    ''
  ).trim();
  const ua = String(req.headers['user-agent'] ?? '');

  const licenseSession = readLicenseToken(token);
  if (licenseSession) {
    const claim = await claimDevice({
      email: licenseSession.email,
      licenseKey: licenseSession.licenseKey,
      orderNumber: licenseSession.orderNumber,
      deviceId: deviceId ?? '',
      deviceName: deviceName ?? 'Device',
      userAgent: ua,
    });
    const devices = claim.devices.map(d => ({ ...d, isCurrent: d.device_id === deviceId }));
    if (!claim.ok) {
      return res.status(200).json({
        valid: true,
        hasSubscription: false,
        subscriptionStatus: 'device_limit',
        email: licenseSession.email,
        firstName: '',
        devices,
      });
    }
    return res.status(200).json({
      valid: true,
      hasSubscription: true,
      subscriptionStatus: 'lifetime',
      planTitle: 'Lifetime Access',
      email: licenseSession.email,
      firstName: '',
      devices,
    });
  }

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
  const [sealResult, ldtLifetime, shopifyLifetime, testerRecord, securityResult, userPrefs] = await Promise.all([
    sealCheckSubscription(email),
    (!isCreator) ? checkLdtLifetime(emailLower) : Promise.resolve({ lifetime: false, webOrder: false }),
    (!isCreator) ? checkShopifyLifetime(token) : Promise.resolve(false),
    (!isCreator) ? checkTesterStatus(emailLower) : Promise.resolve(null),
    (!isCreator) ? checkSecurityFlag(emailLower) : Promise.resolve(false),
    getUserPrefs(emailLower),
  ]);

  const isSecurityExpired = securityResult;
  const envTester = !isCreator && TESTER_EMAILS.has(emailLower);
  const membership = resolveMembership({
    isCreator,
    envTester,
    testerRecord,
    ldtLifetime: ldtLifetime.lifetime || shopifyLifetime,
    ldtWebOrder: ldtLifetime.webOrder || shopifyLifetime,
    seal: sealResult,
  });

  const { hasSub, activeSubs } = sealResult;
  const isTester = membership.isTester;
  const finalHasSub = membership.hasSubscription;
  const finalStatus = membership.subscriptionStatus;
  const finalPlan = membership.planTitle;
  const finalExpiry = membership.subscriptionExpiresAt;

  console.log('Verify result:', { email, hasSub, sealLifetime: sealResult.hasLifetime, everInSeal: sealResult.everInSeal, isCreator, isTester, testerRecord, ldtLifetime: ldtLifetime.lifetime, ldtWebOrder: ldtLifetime.webOrder, shopifyLifetime, finalHasSub, finalStatus, planTitle: finalPlan, nextBillingDate: finalExpiry });

  // ── Log analytics + security events (fire-and-forget) ────────────────────
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

  let outHasSub = finalHasSub;
  let outStatus = finalStatus;
  let devices: Array<LicenseDevice & { isCurrent?: boolean }> | undefined;
  if (outHasSub && !isCreator && deviceId) {
    const claim = await claimDevice({
      email: emailLower,
      deviceId,
      deviceName: deviceName ?? 'Device',
      userAgent: ua,
    });
    devices = claim.devices.map(d => ({ ...d, isCurrent: d.device_id === deviceId }));
    if (!claim.ok) {
      outHasSub = false;
      outStatus = 'device_limit';
    }
  }

  return res.status(200).json({
    valid:                 true,
    hasSubscription:       outHasSub,
    subscriptionStatus:    outStatus,
    subscriptionExpiresAt: finalExpiry,
    planTitle:             finalPlan,
    email,
    firstName:             cust.firstName ?? '',
    accentColor:           userPrefs.accentColor,
    devices,
  });
}
