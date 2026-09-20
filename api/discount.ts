import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes } from 'crypto';

const STORE_ID     = process.env.SHOPIFY_STORE_ID ?? '';
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const ADMIN_TOKEN  = process.env.SHOPIFY_ADMIN_TOKEN ?? '';
const SHOP         = (process.env.SHOPIFY_SHOP ?? 'charleypangus.myshopify.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
const PRODUCT_GID  = toProductGid(process.env.SHOPIFY_ATWEB_PRODUCT_ID ?? '8994290761882');
const LIST_CENTS   = 15900;
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SECRET       = process.env.LICENSE_TOKEN_SECRET || SERVICE_KEY || 'at-trial';
const ADMIN_API    = `https://${SHOP}/admin/api/2025-10/graphql.json`;
const PRODUCT_URL  = 'https://charleypangus.com/products/autothresh-web';

type Offer = 'monthly30' | 'annual50' | 'trial15';

interface Issued {
  code: string;
  percent: number;
  price: string;
  compareAt: string;
  checkoutUrl: string;
  productUrl: string;
}

function toProductGid(raw: string): string {
  const value = String(raw ?? '').trim();
  if (value.startsWith('gid://')) return value;
  const id = value.replace(/\D/g, '');
  return id ? `gid://shopify/Product/${id}` : 'gid://shopify/Product/8994290761882';
}

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function money(cents: number): string {
  const n = Math.max(0, Math.round(cents));
  return n % 100 === 0 ? `$${n / 100}` : `$${(n / 100).toFixed(2)}`;
}

function productUrlWithCode(code: string): string {
  return `${PRODUCT_URL}?discount=${encodeURIComponent(code)}`;
}

function offerMeta(offer: Offer) {
  const percent = offer === 'annual50' ? 50 : offer === 'monthly30' ? 30 : 15;
  const priceCents = Math.round(LIST_CENTS * (1 - percent / 100));
  return {
    percent,
    price: money(priceCents),
    compareAt: money(LIST_CENTS),
    prefix: offer === 'annual50' ? 'ATW50' : offer === 'monthly30' ? 'ATW30' : 'ATW15',
  };
}

function makeCode(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function rankOffer(offer: Offer): number {
  if (offer === 'annual50') return 3;
  if (offer === 'monthly30') return 2;
  return 1;
}

function pickBetter(a: Offer | null, b: Offer | null): Offer | null {
  if (!a) return b;
  if (!b) return a;
  return rankOffer(a) >= rankOffer(b) ? a : b;
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

function parseSubs(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (payload && Array.isArray(payload.subscriptions)) return payload.subscriptions as Array<Record<string, unknown>>;
    for (const key of ['subscriptions', 'data', 'result']) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function planText(s: Record<string, unknown>): string {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  return [
    s.billing_interval, s.interval, s.plan_title, s.product_title, s.plan_name,
    ...items.map(i => String(i.selling_plan_name ?? i.title ?? '')),
  ].filter(Boolean).join(' ').toLowerCase();
}

function isAnnualPlan(text: string): boolean {
  return text.includes('year') || text.includes('annual') || text.includes('12 month');
}

function isMonthlyPlan(text: string): boolean {
  return text.includes('month') && !isAnnualPlan(text);
}

function isLiveStatus(status: string): boolean {
  return status === 'active' || status === 'trial' || status === 'paused';
}

function hadPaidBilling(s: Record<string, unknown>): boolean {
  const attempts = Array.isArray(s.billing_attempts) ? s.billing_attempts as Array<Record<string, unknown>> : [];
  if (attempts.some(a => {
    const st = String(a.status ?? '').toLowerCase();
    return ['success', 'completed', 'paid', 'charged'].includes(st) || !!a.completed_at;
  })) return true;
  const paid = Number(s.total_paid ?? s.amount_paid ?? s.total_price ?? 0);
  return Number.isFinite(paid) && paid > 0;
}

function looksLikeTrial(s: Record<string, unknown>, text: string): boolean {
  const type = Number(s.subscription_type);
  const status = String(s.status ?? '').toLowerCase();
  if (type === 2) return true;
  if (status === 'trial') return true;
  return text.includes('trial');
}

async function entitledSealOffer(email: string): Promise<Offer | null> {
  if (!SEAL_TOKEN) return null;
  const r = await fetch(
    `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}&with-items=true&with-billing-attempts=true`,
    { headers: { 'Content-Type': 'application/json', 'X-Seal-Token': SEAL_TOKEN } },
  );
  if (!r.ok) {
    console.error('discount Seal lookup failed:', r.status, await r.text());
    return null;
  }
  const subs = parseSubs(await r.json());
  let paidAnnual = false;
  let paidMonthly = false;
  let trialEnded = false;
  for (const s of subs) {
    const status = String(s.status ?? '').toLowerCase();
    const text = planText(s);
    if (isLiveStatus(status)) return null;
    if (status !== 'cancelled' && status !== 'canceled') continue;
    const paid = hadPaidBilling(s) || (!looksLikeTrial(s, text) && (isMonthlyPlan(text) || isAnnualPlan(text)));
    if (paid && isAnnualPlan(text)) paidAnnual = true;
    else if (paid && isMonthlyPlan(text)) paidMonthly = true;
    else trialEnded = true;
  }
  if (paidAnnual) return 'annual50';
  if (paidMonthly) return 'monthly30';
  if (trialEnded) return 'trial15';
  return null;
}

function clientIp(req: VercelRequest): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '');
  const first = forwarded.split(',')[0]?.trim();
  return first || String(req.headers['x-real-ip'] ?? '') || req.socket?.remoteAddress || '';
}

function hashIdent(value: string): string {
  return createHash('sha256').update(`${SECRET}|${value}`).digest('hex');
}

function cookieId(req: VercelRequest): string {
  const raw = String(req.headers.cookie ?? '');
  const m = /(?:^|;\s*)at_tid=([0-9a-f-]{36})/i.exec(raw);
  return m?.[1] ?? '';
}

async function expiredAppTrialKey(req: VercelRequest, deviceId: string, fingerprint: string): Promise<string | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const idents: Array<{ kind: string; value: string }> = [];
  const tid = cookieId(req);
  if (tid) idents.push({ kind: 'cookie', value: tid });
  if (deviceId && deviceId !== 'unknown-device') idents.push({ kind: 'device', value: hashIdent(deviceId) });
  if (fingerprint && /^[a-f0-9]{16,64}$/.test(fingerprint)) idents.push({ kind: 'fp', value: fingerprint });
  const ip = clientIp(req);
  if (ip) idents.push({ kind: 'ip', value: hashIdent(ip) });
  if (!idents.length) return null;

  const or = idents.map(i => `and(kind.eq.${i.kind},value.eq.${encodeURIComponent(i.value)})`).join(',');
  const listed = await sb(`app_trial_idents?or=(${or})&select=trial_id`);
  if (!listed.ok) return null;
  const rows = await listed.json() as Array<{ trial_id: string }>;
  const ids = [...new Set(rows.map(r => r.trial_id))];
  if (!ids.length) return null;
  const trials = await sb(`app_trials?id=in.(${ids.join(',')})&select=id,expires_at`);
  if (!trials.ok) return null;
  const found = await trials.json() as Array<{ id: string; expires_at: string }>;
  const expired = found.filter(t => Date.parse(t.expires_at) <= Date.now());
  if (!expired.length) return null;
  expired.sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at));
  return `trial:${expired[0].id}`;
}

async function sb(path: string, method = 'GET', body?: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Prefer: method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function loadSaved(owner: string, offer: Offer): Promise<Issued | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const r = await sb(`discount_codes?email=eq.${encodeURIComponent(owner)}&offer=eq.${offer}&select=code,percent&limit=1`);
  if (!r.ok) {
    console.error('discount_codes load failed:', r.status, await r.text());
    return null;
  }
  const rows = await r.json() as Array<{ code: string; percent: number }>;
  const row = rows[0];
  if (!row?.code) return null;
  const meta = offerMeta(offer);
  return {
    code: row.code,
    percent: row.percent || meta.percent,
    price: meta.price,
    compareAt: meta.compareAt,
    checkoutUrl: productUrlWithCode(row.code),
    productUrl: PRODUCT_URL,
  };
}

async function saveIssued(owner: string, offer: Offer, issued: Issued, shopifyId: string) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const r = await sb('discount_codes', 'POST', {
    email: owner,
    offer,
    code: issued.code,
    shopify_id: shopifyId,
    checkout_url: issued.checkoutUrl,
    percent: issued.percent,
  });
  if (!r.ok) console.error('discount_codes save failed:', r.status, await r.text());
}

async function shopify<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch(ADMIN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json() as T & { errors?: Array<{ message: string }> };
  if (!r.ok || body.errors?.length) {
    throw new Error(body.errors?.map(e => e.message).join('; ') || `Shopify admin ${r.status}`);
  }
  return body;
}

async function createCode(owner: string, offer: Offer): Promise<{ issued: Issued; shopifyId: string }> {
  const meta = offerMeta(offer);
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const mutation = `
    mutation CreateAtwCode($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) { nodes { code } }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  for (let attempt = 0; attempt < 4; attempt++) {
    const code = makeCode(meta.prefix);
    const body = await shopify<{
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id?: string; codeDiscount?: { codes?: { nodes?: Array<{ code: string }> } } };
          userErrors?: Array<{ field?: string[]; message: string }>;
        };
      };
    }>(mutation, {
      basicCodeDiscount: {
        title: `ATW ${meta.percent}% ${owner}`.slice(0, 255),
        code,
        startsAt,
        endsAt,
        usageLimit: 1,
        appliesOncePerCustomer: true,
        combinesWith: {
          orderDiscounts: false,
          productDiscounts: false,
          shippingDiscounts: false,
        },
        customerSelection: { all: true },
        customerGets: {
          value: { percentage: meta.percent / 100 },
          items: { products: { productsToAdd: [PRODUCT_GID] } },
        },
      },
    });

    const payload = body.data?.discountCodeBasicCreate;
    const errors = payload?.userErrors ?? [];
    if (errors.length) {
      const taken = errors.some(e => /already exists|taken|code/i.test(e.message));
      if (taken && attempt < 3) continue;
      throw new Error(errors.map(e => e.message).join('; '));
    }

    const issuedCode = payload?.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code || code;
    const shopifyId = payload?.codeDiscountNode?.id ?? '';
    if (!issuedCode) throw new Error('Shopify did not return a discount code.');
    return {
      shopifyId,
      issued: {
        code: issuedCode,
        percent: meta.percent,
        price: meta.price,
        compareAt: meta.compareAt,
        checkoutUrl: productUrlWithCode(issuedCode),
        productUrl: PRODUCT_URL,
      },
    };
  }

  throw new Error('Could not create a unique discount code.');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body ?? {}) as { token?: string; deviceId?: string; fingerprint?: string };
  const token = String(req.headers.authorization ?? body.token ?? '').replace(/^Bearer /i, '').trim();
  const email = await identify(token);
  const trialKey = await expiredAppTrialKey(req, String(body.deviceId ?? '').trim().slice(0, 80), String(body.fingerprint ?? '').trim().toLowerCase());
  const sealOffer = email ? await entitledSealOffer(email) : null;
  const trialOffer: Offer | null = trialKey ? 'trial15' : null;
  const offer = pickBetter(sealOffer, trialOffer);
  const owner = email || trialKey;
  if (!offer || !owner) return res.status(403).json({ error: 'No discount on this account.' });

  const saved = await loadSaved(owner, offer);
  if (saved) return res.status(200).json(saved);

  if (!ADMIN_TOKEN) {
    console.error('SHOPIFY_ADMIN_TOKEN is not set');
    return res.status(500).json({ error: 'Discount codes are not set up yet. Email autothreshweb@gmail.com and we will send you one.' });
  }

  try {
    const { issued, shopifyId } = await createCode(owner, offer);
    await saveIssued(owner, offer, issued, shopifyId);
    return res.status(200).json(issued);
  } catch (err) {
    console.error('discount create failed:', err);
    return res.status(500).json({ error: 'Could not create your one-time code. Try again, or email autothreshweb@gmail.com.' });
  }
}
