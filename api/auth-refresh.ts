import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLIENT_ID = process.env.customer!;
const STORE_ID  = process.env.SHOPIFY_STORE_ID!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { refresh_token } = req.body as { refresh_token?: string };
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });

  const tokenRes = await fetch(
    `https://shopify.com/authentication/${STORE_ID}/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token,
        client_id:     CLIENT_ID,
      }),
    }
  );

  const body = await tokenRes.text();
  if (!tokenRes.ok) {
    console.error('Token refresh failed:', tokenRes.status, body.slice(0, 200));
    return res.status(401).json({ error: 'refresh failed' });
  }

  const tokens = JSON.parse(body) as { id_token?: string; refresh_token?: string; access_token?: string };
  console.log('Token refresh OK, id_token present:', !!tokens.id_token);
  return res.status(200).json({
    idToken:      tokens.id_token,
    refreshToken: tokens.refresh_token, // Shopify rotates it — client should save the new one
  });
}
