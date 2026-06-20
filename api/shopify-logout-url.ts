import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';
const APP_ORIGIN   = new URL(REDIRECT_URI).origin;

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id_token_hint } = req.query as { id_token_hint?: string };

  const params = new URLSearchParams({ return_to: APP_ORIGIN });
  if (id_token_hint) params.set('id_token_hint', id_token_hint);

  const logoutUrl = `https://shopify.com/authentication/${STORE_ID}/logout?${params}`;
  return res.status(200).json({ logoutUrl });
}
