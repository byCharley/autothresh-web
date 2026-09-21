import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ACTIVE_SUBSCRIPTION_EXPORT } from './_data/activeSubscriptions';
import { upsertPlanAccess } from './_lib/planAccess';

export const config = { maxDuration: 30 };

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
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

/**
 * Seed plan_access from the Seal export only (no Seal cancels).
 * Use this when cancelling subscriptions manually in Seal.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!(await verifyCreator(token))) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      total: ACTIVE_SUBSCRIPTION_EXPORT.length,
      sample: ACTIVE_SUBSCRIPTION_EXPORT.slice(0, 3),
    });
  }

  const body = readBody(req);
  const offset = Math.max(0, parseInt(String(body.offset ?? '0'), 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(String(body.limit ?? '50'), 10) || 50));
  const slice = ACTIVE_SUBSCRIPTION_EXPORT.slice(offset, offset + limit);

  let saved = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of slice) {
    const until = new Date(row.nextBillingDate);
    if (Number.isNaN(until.getTime())) {
      failed++;
      errors.push(`${row.email}: bad date`);
      continue;
    }
    const result = await upsertPlanAccess({
      email: row.email,
      accessUntil: until.toISOString(),
      planTitle: row.planTitle,
      sealSubscriptionId: row.id,
    });
    if (!result.ok) {
      failed++;
      if (result.error?.includes('plan_access table missing')) {
        return res.status(500).json({ error: result.error, setupError: result.error });
      }
      errors.push(`${row.email}: ${result.error || 'failed'}`);
      continue;
    }
    saved++;
  }

  const nextOffset = offset + slice.length;
  const done = nextOffset >= ACTIVE_SUBSCRIPTION_EXPORT.length;

  return res.status(200).json({
    ok: true,
    total: ACTIVE_SUBSCRIPTION_EXPORT.length,
    offset,
    saved,
    failed,
    done,
    nextOffset: done ? null : nextOffset,
    errors: errors.slice(0, 10),
  });
}
