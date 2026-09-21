import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sunsetAllRecurringSubscriptions } from './_lib/sealSunset';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const CRON_SECRET  = process.env.CRON_SECRET ?? '';
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

async function verifyCreator(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ query: 'query { customer { emailAddress { emailAddress } } }' }),
    });
    const body = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    const email = body?.data?.customer?.emailAddress?.emailAddress ?? '';
    return CREATOR_EMAILS.has(email.toLowerCase());
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = String(req.headers.authorization ?? '');
  const token = auth.replace(/^Bearer /, '');
  const isCron = !!CRON_SECRET && auth === `Bearer ${CRON_SECRET}`;
  const isCreator = !isCron && await verifyCreator(token);
  if (!isCron && !isCreator) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { scanned, results } = await sunsetAllRecurringSubscriptions();
    const summary = {
      ok: true,
      scanned,
      scheduled: results.filter(r => r.action === 'scheduled').length,
      cancelled_now: results.filter(r => r.action === 'cancelled_now').length,
      skipped: results.filter(r => r.action === 'skipped').length,
      failed: results.filter(r => r.action === 'failed').length,
      results,
    };
    console.log('[sunset-subscriptions]', JSON.stringify({
      scanned: summary.scanned,
      scheduled: summary.scheduled,
      cancelled_now: summary.cancelled_now,
      skipped: summary.skipped,
      failed: summary.failed,
    }));
    return res.status(200).json(summary);
  } catch (e) {
    console.error('[sunset-subscriptions] error', e);
    return res.status(500).json({ error: 'Failed to sunset subscriptions' });
  }
}
