import type { VercelRequest, VercelResponse } from '@vercel/node';

const SEAL_TOKEN = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const email = String(req.query.email ?? '');
  if (!email) return res.status(400).json({ error: 'email required' });

  const url = `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`;
  const r = await fetch(url, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
  const raw = await r.text();
  return res.status(200).json({ status: r.status, tokenPresent: !!SEAL_TOKEN, body: JSON.parse(raw) });
}
