import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';
const APP_ORIGIN   = new URL(REDIRECT_URI).origin;

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // No id_token_hint — expired tokens cause Shopify to error.
  // return_to must be registered in Shopify app Logout URIs.
  const params = new URLSearchParams({ return_to: APP_ORIGIN });

  const logoutUrl = `https://shopify.com/authentication/${STORE_ID}/logout?${params}`;
  return res.status(200).json({ logoutUrl });
}
