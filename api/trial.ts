import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  buildDeviceIdents,
  claimAppTrialForShopify,
  lookupAppTrial,
  trialConfigured,
} from './_lib/appTrial.js';

const STORE_ID = process.env.SHOPIFY_STORE_ID ?? '65544683674';
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function shopifyEmailFromToken(token: string): Promise<string | null> {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!trialConfigured()) return res.status(500).json({ error: 'Trial is not configured.' });

  const body = (req.body ?? {}) as {
    deviceId?: string;
    fingerprint?: string;
    token?: string;
  };
  const fingerprint = String(body.fingerprint ?? '').trim().toLowerCase();
  if (fingerprint && !/^[a-f0-9]{16,64}$/.test(fingerprint)) {
    return res.status(400).json({ error: 'Invalid fingerprint.' });
  }

  const token = String(body.token ?? '').trim();
  const shopifyEmail = token ? await shopifyEmailFromToken(token) : null;
  if (token && !shopifyEmail) {
    return res.status(401).json({ error: 'Sign in to start your free trial.' });
  }

  const idents = buildDeviceIdents({
    req,
    deviceId: body.deviceId,
    fingerprint,
  });
  if (!idents.length && !shopifyEmail) {
    return res.status(400).json({ error: 'Could not start trial.' });
  }

  const lookupOnly = req.query.action === 'status';

  try {
    if (shopifyEmail) {
      const claimed = await claimAppTrialForShopify(shopifyEmail, idents, {
        req,
        res,
        createIfMissing: !lookupOnly,
      });
      if (lookupOnly && claimed.status === 'none') {
        return res.status(200).json({ status: 'none' });
      }
      if (claimed.status === 'network_limit') {
        return res.status(403).json({
          status: 'network_limit',
          error: 'A free trial was already started from this network.',
        });
      }
      return res.status(200).json(claimed);
    }

    // Anonymous Continue — this browser only (no IP / household merge).
    const existing = await lookupAppTrial(idents, { req, res });
    if (existing.status !== 'none') {
      return res.status(200).json(existing);
    }

    if (lookupOnly) return res.status(200).json({ status: 'none' });

    return res.status(401).json({
      error: 'Sign in to start your free trial.',
      needSignIn: true,
    });
  } catch {
    return res.status(500).json({ error: 'Could not start trial.' });
  }
}
