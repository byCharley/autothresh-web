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

function normOrder(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '');
}

function walkStrings(o: unknown, pick: (key: string, val: string) => void) {
  if (o == null) return;
  if (Array.isArray(o)) { o.forEach(v => walkStrings(v, pick)); return; }
  if (typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number') pick(k, String(v));
    else walkStrings(v, pick);
  }
}

function extractLicenseFields(o: unknown): { licenseKey: string; orderNumber: string; email: string; product: string } {
  let licenseKey = '';
  let orderNumber = '';
  let email = '';
  let product = '';
  walkStrings(o, (key, val) => {
    const k = key.toLowerCase();
    const v = val.trim();
    if (!v) return;
    if (!licenseKey && /(license[_-]?key|licensekey|license_code|serial)$/.test(k) && v.length >= 6) licenseKey = v;
    if (!licenseKey && k === 'key' && v.length >= 8) licenseKey = v;
    if (!orderNumber && /(order[_-]?(number|name|id)|ordername)$/.test(k)) orderNumber = v;
    if (!orderNumber && (k === 'name' || k === 'order') && /#?\d+/.test(v)) orderNumber = v;
    if (!email && k.includes('email') && v.includes('@')) email = v.toLowerCase();
    if (!product && /(product[_-]?title|producttitle|title|product)$/.test(k)) product += ` ${v}`;
  });
  return { licenseKey, orderNumber, email, product: product.toLowerCase() };
}

function isAutothreshWeb(text: string): boolean {
  const t = text.toLowerCase().replace(/™/g, '');
  if (t.includes('autothresh pro') || t.includes('autothresh lite')) return false;
  return t.includes('autothresh web') || t.includes('autothresh-web') || t.includes('autothreshweb') || t.includes('autothresh');
}

async function ldtGet(path: string): Promise<{ ok: boolean; raw: unknown; text: string }> {
  const r = await fetch(`${LDT_API_URL}${path}`, {
    headers: { 'LDT-X-Access-Token': LDT_ACCESS },
  });
  const text = await r.text();
  let raw: unknown = null;
  try { raw = JSON.parse(text); } catch { raw = text; }
  return { ok: r.ok, raw, text };
}

async function lookupLicense(licenseKey: string): Promise<{ ok: boolean; email: string; orderNumber: string; product: string; raw: unknown }> {
  const { ok, raw } = await ldtGet(`/license?key=${encodeURIComponent(licenseKey)}`);
  const fields = extractLicenseFields(raw);
  return {
    ok,
    email: fields.email,
    orderNumber: fields.orderNumber,
    product: fields.product || JSON.stringify(raw ?? '').toLowerCase(),
    raw,
  };
}

async function lookupOrderByEmail(email: string): Promise<{ licenseKey: string; orderNumber: string; product: string } | null> {
  const { ok, raw } = await ldtGet(`/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=50`);
  if (!ok) return null;
  let orders: unknown[] = [];
  if (Array.isArray(raw)) orders = raw;
  else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['data', 'orders', 'items', 'result', 'list', 'payload']) {
      const v = obj[key];
      if (Array.isArray(v)) { orders = v; break; }
      if (v && typeof v === 'object') {
        const nested = v as Record<string, unknown>;
        for (const k2 of ['data', 'orders', 'items', 'list']) {
          if (Array.isArray(nested[k2])) { orders = nested[k2] as unknown[]; break; }
        }
      }
    }
  }
  for (const order of orders) {
    const json = JSON.stringify(order).toLowerCase();
    if (!isAutothreshWeb(json)) continue;
    const fields = extractLicenseFields(order);
    if (fields.licenseKey) {
      return { licenseKey: fields.licenseKey, orderNumber: fields.orderNumber, product: fields.product };
    }
  }
  return null;
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
    const licenseKey = String(body.licenseKey ?? '').trim();
    const orderNumber = String(body.orderNumber ?? '').trim();
    if (!licenseKey || !orderNumber) {
      return res.status(400).json({ error: 'License key and order number are required.' });
    }
    if (!deviceId) return res.status(400).json({ error: 'Device id required.' });
    if (!LDT_ACCESS) return res.status(500).json({ error: 'License lookup is not configured.' });

    const license = await lookupLicense(licenseKey);
    console.log('LDT license lookup:', { ok: license.ok, hasEmail: !!license.email, hasOrder: !!license.orderNumber });
    if (!license.ok) {
      return res.status(200).json({ ok: false, error: 'That license key was not found. Check the key from your order email or Charley Pangus account.' });
    }
    const blob = JSON.stringify(license.raw ?? {}).toLowerCase();
    const productText = `${license.product} ${blob}`;
    if (productText.includes('autothresh pro') || productText.includes('autothresh lite')) {
      return res.status(200).json({ ok: false, error: 'That license is not for AutoThresh Web.' });
    }
    const expectedOrder = normOrder(license.orderNumber);
    const givenOrder = normOrder(orderNumber);
    if (expectedOrder && givenOrder && expectedOrder !== givenOrder && !expectedOrder.includes(givenOrder) && !givenOrder.includes(expectedOrder)) {
      return res.status(200).json({ ok: false, error: 'That order number does not match this license key.' });
    }

    const email = license.email || `license-${licenseKey.slice(0, 8).toLowerCase()}@autothresh.local`;
    const claim = await claimDevice({
      email,
      licenseKey,
      orderNumber: license.orderNumber || orderNumber,
      deviceId,
      deviceName,
      userAgent,
    });
    const token = signLicenseToken({ email, licenseKey, orderNumber: license.orderNumber || orderNumber });
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
