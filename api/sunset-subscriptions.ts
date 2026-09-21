import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sunsetSubscriptionBatch } from './_lib/sealSunset';

// Keep under common Vercel limits (hobby ~10s). Client loops pages.
export const config = { maxDuration: 30 };

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

function readBody(req: VercelRequest): Record<string, unknown> {
  if (typeof req.body === 'object' && req.body && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = String(req.headers.authorization ?? '');
    const token = auth.replace(/^Bearer /, '');
    const isCron = !!CRON_SECRET && auth === `Bearer ${CRON_SECRET}`;
    const isCreator = !isCron && await verifyCreator(token);
    if (!isCron && !isCreator) return res.status(401).json({ error: 'Unauthorized' });

    const body = readBody(req);
    const q = req.query;
    const filterRaw = String(body.filter ?? q.filter ?? 'active');
    const filter = filterRaw === 'paused' ? 'paused' as const : 'active' as const;
    const page = Math.max(1, parseInt(String(body.page ?? q.page ?? '1'), 10) || 1);
    // Small pages so each invocation stays under ~10s serverless timeouts.
    const perPage = Math.min(15, Math.max(5, parseInt(String(body.perPage ?? q.perPage ?? '8'), 10) || 8));

    const batch = await sunsetSubscriptionBatch({ filter, page, perPage });
    return res.status(200).json({
      ok: true,
      scanned: batch.scanned,
      scheduled: 0,
      cancelled_now: batch.results.filter(r => r.action === 'cancelled_now').length,
      skipped: batch.results.filter(r => r.action === 'skipped').length,
      failed: batch.results.filter(r => r.action === 'failed').length,
      filter: batch.filter,
      page: batch.page,
      hasMore: batch.hasMore,
      nextFilter: batch.nextFilter,
      nextPage: batch.nextPage,
      done: batch.done,
      setupError: batch.setupError,
    });
  } catch (e) {
    console.error('[sunset-subscriptions] error', e);
    // Always JSON — never plain-text platform messages for the UI parser.
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to sunset subscriptions',
    });
  }
}
