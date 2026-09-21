import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';

const LDT_ACCESS   = process.env.LDT_ACCESS ?? '';
const LDT_API_URL  = 'https://digital.ldtsoft.work/api/integrate';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SECRET       = process.env.LICENSE_TOKEN_SECRET || SERVICE_KEY || 'at-license';
const STORE_ID     = process.env.SHOPIFY_STORE_ID ?? '';
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const DEVICE_CAP   = 2;

export interface LicenseDevice {
  id: string;
  device_id: string;
  device_name: string;
  last_seen_at: string;
  created_at: string;
  isCurrent?: boolean;
}

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function normalizeOrder(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^order\s*#?\s*/i, '')
    .replace(/^#/, '')
    .replace(/\s+/g, '');
}

type LdtOrder = {
  orderId?: string;
  orderName?: string;
  orderEmail?: string;
  isDisabled?: boolean;
  isCancelled?: boolean;
  itemName?: string;
  itemSku?: string | null;
  shopifyOrderName?: string;
  shopifyOrderId?: string;
  shopify_order_id?: string;
  id?: string;
  digitalOrderId?: string;
};

type LdtLicense = {
  key: string;
  order: LdtOrder | null;
};

/** Unwrap LDT /license?key=… which may be an array, bare object, or envelope. */
function pickLicense(data: unknown): LdtLicense | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    if (!data.length) return null;
    return pickLicense(data[0]);
  }
  if (typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (obj.license && typeof obj.license === 'object') return pickLicense(obj.license);
  if (obj.data && (Array.isArray(obj.data) || typeof obj.data === 'object')) return pickLicense(obj.data);

  const key = obj.key || obj.licenseKey || obj.license_key;
  if (!key) return null;
  const order = (obj.order || obj.Order || null) as LdtOrder | null;
  return { key: String(key), order };
}

/**
 * Match the typed order number against every Shopify / LDT order identifier
 * on the license. Customers type `#5845` from the email; LDT also stores the
 * internal Shopify id (`6961…`) on `orderId` — accepting either is required.
 */
function orderMatches(licenseOrder: LdtOrder | null, userOrder: string): boolean {
  if (!licenseOrder) return false;
  const want = normalizeOrder(userOrder);
  if (!want) return false;
  const candidates = [
    licenseOrder.orderName,
    licenseOrder.orderId,
    licenseOrder.shopifyOrderName,
    licenseOrder.shopifyOrderId,
    licenseOrder.shopify_order_id,
    licenseOrder.id,
    licenseOrder.digitalOrderId,
  ];
  return candidates.some(c => {
    const n = normalizeOrder(String(c ?? ''));
    return !!n && (n === want || n.includes(want) || want.includes(n));
  });
}

function isAutothreshWebProduct(itemName?: string, itemSku?: string | null): boolean {
  const blob = `${itemName ?? ''} ${itemSku ?? ''}`.toLowerCase().replace(/™/g, '');
  if (
    blob.includes('autothresh pro') ||
    blob.includes('autothresh lite') ||
    blob.includes('autobitmap') ||
    blob.includes('displacecraft') ||
    blob.includes('filter dock') ||
    blob.includes('filterforge') ||
    blob.includes('filter forge')
  ) {
    return false;
  }
  return (
    blob.includes('autothresh web') ||
    blob.includes('autothresh-web') ||
    blob.includes('autothreshweb') ||
    // Lifetime / one-time AutoThresh Web titles sometimes omit "Web"
    (blob.includes('autothresh') && !blob.includes('pro') && !blob.includes('lite'))
  );
}

async function ldtGet(path: string): Promise<{ ok: boolean; raw: unknown; text: string }> {
  const r = await fetch(`${LDT_API_URL}${path}`, {
    headers: { Accept: 'application/json', 'LDT-X-Access-Token': LDT_ACCESS },
  });
  const text = await r.text();
  let raw: unknown = null;
  try { raw = JSON.parse(text); } catch { raw = text; }
  return { ok: r.ok, raw, text };
}

function signLicenseToken(p: { email: string; licenseKey: string; orderNumber: string }): string {
  const exp = Date.now() + 30 * 86_400_000;
  const payload = Buffer.from(JSON.stringify({ ...p, exp })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `atlic.${payload}.${sig}`;
}

export function readLicenseToken(token: string): { email: string; licenseKey: string; orderNumber: string } | null {
  if (!token.startsWith('atlic.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  const sig = parts[2];
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email?: string; licenseKey?: string; orderNumber?: string; exp?: number };
    if (!data.exp || data.exp < Date.now()) return null;
    if (!data.email || !data.licenseKey) return null;
    return { email: data.email, licenseKey: data.licenseKey, orderNumber: data.orderNumber ?? '' };
  } catch { return null; }
}

async function sb(path: string, method = 'GET', body?: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Prefer: method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=minimal' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function loadDevices(email: string, licenseKey?: string): Promise<LicenseDevice[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [];
  const filters = [`email=eq.${encodeURIComponent(email)}`];
  if (licenseKey) filters.push(`license_key=eq.${encodeURIComponent(licenseKey)}`);
  const r = await sb(`license_devices?or=(${filters.join(',')})&select=id,device_id,device_name,last_seen_at,created_at&order=last_seen_at.desc`);
  if (!r.ok) {
    console.error('license_devices load failed:', r.status, await r.text());
    return [];
  }
  return await r.json() as LicenseDevice[];
}

export async function claimDevice(opts: {
  email: string;
  licenseKey?: string;
  orderNumber?: string;
  deviceId: string;
  deviceName: string;
  userAgent: string;
}): Promise<{ ok: boolean; devices: LicenseDevice[]; reason?: string }> {
  const { email, licenseKey, orderNumber, deviceId, deviceName, userAgent } = opts;
  const devices = await loadDevices(email, licenseKey);
  const existing = devices.find(d => d.device_id === deviceId);
  if (existing) {
    await sb(`license_devices?device_id=eq.${encodeURIComponent(deviceId)}&email=eq.${encodeURIComponent(email)}`, 'PATCH', {
      last_seen_at: new Date().toISOString(),
      device_name: deviceName || existing.device_name,
      user_agent: userAgent,
    });
    return { ok: true, devices: devices.map(d => ({ ...d, isCurrent: d.device_id === deviceId })) };
  }
  if (devices.length >= DEVICE_CAP) {
    return { ok: false, devices, reason: 'device_limit' };
  }
  const inserted = await sb('license_devices', 'POST', {
    email,
    license_key: licenseKey || null,
    order_number: orderNumber || null,
    device_id: deviceId,
    device_name: deviceName || 'Device',
    user_agent: userAgent,
  });
  if (!inserted.ok) {
    console.error('license_devices insert failed:', inserted.status, await inserted.text());
  }
  const next = await loadDevices(email, licenseKey);
  return { ok: true, devices: next.map(d => ({ ...d, isCurrent: d.device_id === deviceId })) };
}

async function emailFromShopify(token: string): Promise<string | null> {
  if (!token || token.startsWith('atlic.') || !STORE_ID) return null;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ query: `query { customer { emailAddress { emailAddress } } }` }),
    });
    const body = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    return (body.data?.customer?.emailAddress?.emailAddress ?? '').toLowerCase() || null;
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body ?? {}) as Record<string, string>;
  const action = String(body.action ?? 'activate');
  const deviceId = String(body.deviceId ?? '').trim();
  const deviceName = String(body.deviceName ?? 'Device');
  const userAgent = String(req.headers['user-agent'] ?? '');

  if (action === 'activate') {
    // Strip zero-width / non-printable junk from emailed keys.
    const licenseKey = String(body.licenseKey ?? '').replace(/[^\x21-\x7E]/g, '').trim();
    const orderNumber = String(body.orderNumber ?? '').trim();
    if (!licenseKey || !orderNumber) {
      return res.status(400).json({ error: 'License key and order number are required.' });
    }
    if (!deviceId) return res.status(400).json({ error: 'Device id required.' });
    if (!LDT_ACCESS) return res.status(500).json({ error: 'License lookup is not configured.' });

    const licenseRes = await ldtGet(`/license?key=${encodeURIComponent(licenseKey)}`);
    const license = pickLicense(licenseRes.raw);
    console.log('LDT license lookup:', {
      httpOk: licenseRes.ok,
      found: !!license,
      orderName: license?.order?.orderName ?? null,
      orderId: license?.order?.orderId ?? null,
      itemName: license?.order?.itemName ?? null,
    });

    if (!licenseRes.ok || !license) {
      return res.status(200).json({
        ok: false,
        error: 'That license key was not found. Check the key from your order email or Charley Pangus account.',
      });
    }

    const order = license.order;
    if (!order) {
      return res.status(200).json({ ok: false, error: 'That license is not linked to an order yet. Try again in a minute.' });
    }
    if (order.isCancelled) {
      return res.status(200).json({ ok: false, error: 'That order was cancelled, so this license cannot be activated.' });
    }
    if (order.isDisabled) {
      return res.status(200).json({ ok: false, error: 'That license has been disabled. Contact support if this is a mistake.' });
    }
    if (!isAutothreshWebProduct(order.itemName, order.itemSku)) {
      return res.status(200).json({ ok: false, error: 'That license is not for AutoThresh Web.' });
    }
    if (!orderMatches(order, orderNumber)) {
      return res.status(200).json({
        ok: false,
        error: 'That order number does not match this license key. Use the Shopify order number from the same purchase (e.g. #5845).',
      });
    }

    const email = (order.orderEmail || `license-${licenseKey.slice(0, 8).toLowerCase()}@autothresh.local`).toLowerCase();
    const resolvedOrder = order.orderName || order.orderId || orderNumber;
    const claim = await claimDevice({
      email,
      licenseKey,
      orderNumber: resolvedOrder,
      deviceId,
      deviceName,
      userAgent,
    });
    const token = signLicenseToken({ email, licenseKey, orderNumber: resolvedOrder });
    if (!claim.ok) {
      return res.status(200).json({
        ok: false,
        token,
        email,
        hasSubscription: false,
        subscriptionStatus: 'device_limit',
        devices: claim.devices.map(d => ({ ...d, isCurrent: d.device_id === deviceId })),
        error: 'This license is already active on 2 devices. Remove one to continue.',
      });
    }
    return res.status(200).json({
      ok: true,
      token,
      email,
      firstName: '',
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      hasSubscription: true,
      subscriptionStatus: 'lifetime',
      planTitle: 'Lifetime Access',
      devices: claim.devices,
    });
  }

  const token = String(body.token ?? req.headers.authorization ?? '').replace(/^Bearer /i, '');
  const session = readLicenseToken(token);
  const shopifyEmail = session ? null : await emailFromShopify(token);
  const email = session?.email || shopifyEmail;
  if (!email) return res.status(401).json({ error: 'Sign in again to manage devices.' });
  const licenseKey = session?.licenseKey;

  if (action === 'devices') {
    const devices = await loadDevices(email, licenseKey);
    return res.status(200).json({
      ok: true,
      devices: devices.map(d => ({ ...d, isCurrent: d.device_id === deviceId })),
    });
  }

  if (action === 'remove') {
    const removeDeviceId = String(body.removeDeviceId ?? '').trim();
    if (!removeDeviceId) return res.status(400).json({ error: 'Device to remove is required.' });
    const or = licenseKey
      ? `or=(email.eq.${encodeURIComponent(email)},license_key.eq.${encodeURIComponent(licenseKey)})`
      : `email=eq.${encodeURIComponent(email)}`;
    const del = await sb(`license_devices?device_id=eq.${encodeURIComponent(removeDeviceId)}&${or}`, 'DELETE');
    if (!del.ok) console.error('device remove failed:', del.status, await del.text());
    const devices = await loadDevices(email, licenseKey);
    return res.status(200).json({
      ok: true,
      devices: devices.map(d => ({ ...d, isCurrent: d.device_id === deviceId })),
    });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
