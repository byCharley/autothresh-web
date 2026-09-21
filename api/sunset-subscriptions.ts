import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cancelExportBatch, loadActiveSubscriptionExport } from './_lib/cancelFromExport';

// Small batches — one Seal cancel + one Supabase write per row.
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

    // Preview: how many rows the export has loaded.
    if (req.method === 'GET' || req.query.preview === '1') {
      const rows = loadActiveSubscriptionExport();
      return res.status(200).json({
        ok: true,
        total: rows.length,
        sample: rows.slice(0, 3).map(r => ({
          id: r.id,
          email: r.email,
          nextBillingDate: r.nextBillingDate,
          planTitle: r.planTitle,
        })),
      });
    }

    const body = readBody(req);
    const offset = Math.max(0, parseInt(String(body.offset ?? req.query.offset ?? '0'), 10) || 0);
    const limit = Math.min(15, Math.max(1, parseInt(String(body.limit ?? req.query.limit ?? '6'), 10) || 6));

    const batch = await cancelExportBatch({ offset, limit });
    if (batch.setupError) {
      return res.status(500).json({ error: batch.setupError, setupError: batch.setupError });
    }

    return res.status(200).json({
      ok: true,
      total: batch.total,
      offset: batch.offset,
      processed: batch.processed,
      cancelled_now: batch.results.filter(r => r.action === 'cancelled_now').length,
      skipped: batch.results.filter(r => r.action === 'skipped').length,
      failed: batch.results.filter(r => r.action === 'failed').length,
      done: batch.done,
      nextOffset: batch.nextOffset,
      results: batch.results,
    });
  } catch (e) {
    console.error('[sunset-subscriptions] error', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to cancel subscriptions',
    });
  }
}
