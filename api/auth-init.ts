import type { VercelRequest, VercelResponse } from '@vercel/node';

// Keeps client_id and store_id server-side — browser only sends the PKCE challenge
const CLIENT_ID    = process.env.customer!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';

const SCOPES = 'openid email profile https://api.customers.com/auth/customer.graphql';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { challenge, state } = req.query as { challenge?: string; state?: string };
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

  const redirectUrl = `https://shopify.com/authentication/${STORE_ID}/oauth/authorize?${params}`;
  return res.status(200).json({ redirectUrl });
}
