import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';
const APP_ORIGIN   = new URL(REDIRECT_URI).origin;

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id_token, origin } = req.query as { id_token?: string; origin?: string };

  // Use the client's window.location.origin so the redirect URI matches exactly
  // whichever host (www vs apex) the user is on — Shopify does a byte-for-byte
  // comparison against registered Logout URIs.
  const redirectUri = origin || APP_ORIGIN;

  // id_token_hint is required — Shopify returns an error page without it.
  // post_logout_redirect_uri is the OIDC standard; return_to is Shopify's alias.
  const params = new URLSearchParams({
    post_logout_redirect_uri: redirectUri,
    return_to: redirectUri,
  });
  if (id_token) params.set('id_token_hint', id_token);

  const logoutUrl = `https://shopify.com/authentication/${STORE_ID}/logout?${params}`;
  console.log('Shopify logout URL:', logoutUrl, '| id_token present:', !!id_token, '| origin:', redirectUri);
  return res.status(200).json({ logoutUrl });
}
