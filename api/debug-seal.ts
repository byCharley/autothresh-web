import type { VercelRequest, VercelResponse } from '@vercel/node';

const SEAL_TOKEN = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const email = String(req.query.email ?? '');
  if (!email) return res.status(400).json({ error: 'email required' });

  const [sealRes, flagsRes] = await Promise.all([
    fetch(`${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`, {
      headers: { 'X-Seal-Token': SEAL_TOKEN },
    }),
    fetch(`${SUPABASE_URL}/rest/v1/security_flags?email=eq.${encodeURIComponent(email.toLowerCase())}&select=email,expired,reason,confidence,auto_flagged`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    }),
  ]);

  const sealBody = await sealRes.json();
  const flagsBody = await flagsRes.json();

  return res.status(200).json({
    seal: { status: sealRes.status, body: sealBody },
    securityFlags: flagsBody,
  });
}
