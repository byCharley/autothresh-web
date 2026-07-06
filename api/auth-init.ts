import type { VercelRequest, VercelResponse } from '@vercel/node';

// Keeps client_id and store_id server-side — browser only sends the PKCE challenge
const CLIENT_ID    = process.env.customer!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';

const SCOPES    = 'openid email customer-account-api:full';
const APP_ORIGIN = new URL(REDIRECT_URI).origin;

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Logout URL (merged from shopify-logout-url.ts)
  if (req.query.action === 'logout') {
    const { id_token, origin } = req.query as { id_token?: string; origin?: string };
    const redirectUri = origin || APP_ORIGIN;
    const params = new URLSearchParams({ post_logout_redirect_uri: redirectUri, return_to: redirectUri });
    if (id_token) params.set('id_token_hint', id_token);
    const logoutUrl = `https://shopify.com/authentication/${STORE_ID}/logout?${params}`;
    console.log('Shopify logout URL:', logoutUrl, '| id_token present:', !!id_token, '| origin:', redirectUri);
    return res.status(200).json({ logoutUrl });
  }

  const { challenge, state, nonce, prompt } = req.query as { challenge?: string; state?: string; nonce?: string; prompt?: string };
  if (!challenge || !state) return res.status(400).json({ error: 'challenge and state required' });

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    response_type:         'code',
    redirect_uri:          REDIRECT_URI,
    scope:                 SCOPES,
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });

  if (nonce) params.set('nonce', nonce);
  if (prompt) params.set('prompt', prompt);

  const redirectUrl = `https://shopify.com/authentication/${STORE_ID}/oauth/authorize?${params}`;
  return res.status(200).json({ redirectUrl });
}
