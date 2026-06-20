import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLIENT_ID    = process.env.customer!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';

const PRODUCT_KEYWORD = (process.env.SHOPIFY_PRODUCT_TITLE ?? 'autothresh').toLowerCase();

// Correct endpoint confirmed from working Lovable project:
// - no /authentication/ in path
// - version 2024-07
// - Authorization is raw token, no "Bearer" prefix
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, codeVerifier } = req.body as { code?: string; codeVerifier?: string };
  if (!code || !codeVerifier) return res.status(400).json({ error: 'code and codeVerifier required' });

  // ── 1. Exchange code for tokens ────────────────────────────────────────────
  const tokenRes  = await fetch(
    `https://shopify.com/authentication/${STORE_ID}/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
        code,
        code_verifier: codeVerifier,
      }),
    }
  );

  const tokenBody = await tokenRes.text();

  if (!tokenRes.ok) {
    console.error('Token exchange HTTP error:', tokenRes.status, tokenBody.slice(0, 300));
    return res.status(401).json({ error: 'Token exchange failed' });
  }

  let tokens: { access_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string };
  try {
    tokens = JSON.parse(tokenBody);
  } catch {
    console.error('Token exchange: non-JSON response:', tokenBody.slice(0, 300));
    return res.status(401).json({ error: 'Token exchange bad response' });
  }

  console.log('Token exchange result:', JSON.stringify({
    hasAccessToken: !!tokens.access_token,
    hasIdToken:     !!tokens.id_token,
    expiresIn:      tokens.expires_in,
    error:          tokens.error,
    accessTokenLen: tokens.access_token?.length,
  }));

  if (tokens.error || !tokens.access_token || !tokens.id_token) {
    console.error('Token exchange error:', tokens.error, tokens.error_description);
    return res.status(401).json({ error: tokens.error ?? 'Token exchange missing fields' });
  }

  // ── 2. Get email from id_token ────────────────────────────────────────────
  const claims    = decodeJwtPayload(tokens.id_token);
  const email     = claims.email as string;
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

  // ── 3. Query Customer Account API ─────────────────────────────────────────
  // URL: shopify.com/{store_id}/account/customer/api/2024-07/graphql
  // Auth: raw access token, no "Bearer" prefix
  let rawBody = '';
  let custData: { data?: Record<string, unknown>; errors?: unknown[] } = {};
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': tokens.access_token,
      },
      body: JSON.stringify({
        query: `
          query {
            customer {
              firstName
              emailAddress { emailAddress }
              subscriptionContracts(first: 20) {
                edges {
                  node {
                    status
                    lines(first: 10) {
                      edges {
                        node { title }
                      }
                    }
                  }
                }
              }
              orders(first: 20) {
                edges {
                  node {
                    lineItems(first: 10) {
                      edges {
                        node { title }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
      }),
    });
    rawBody = await r.text();
    custData = JSON.parse(rawBody);
  } catch (e) {
    console.error('Customer API error:', String(e), 'raw:', rawBody.slice(0, 200));
  }

  type LineEdge  = { node: { title: string } };
  type SubNode   = { status: string; lines: { edges: LineEdge[] } };
  type OrdNode   = { lineItems: { edges: LineEdge[] } };
  type CustNode  = {
    firstName?: string;
    emailAddress?: { emailAddress: string };
    subscriptionContracts?: { edges: { node: SubNode }[] };
    orders?: { edges: { node: OrdNode }[] };
  };

  const cust = (custData.data as { customer?: CustNode })?.customer;

  console.log('CUST_API_RESULT:', JSON.stringify({
    hasCustomer: !!cust,
    errors:      custData.errors,
    rawSlice:    rawBody.slice(0, 400),
  }));

  if (!cust) {
    return res.status(200).json({
      token: tokens.access_token, expiresAt,
      email, firstName: '', hasSubscription: false,
    });
  }

  const subEdges = cust.subscriptionContracts?.edges ?? [];
  const ordEdges = cust.orders?.edges ?? [];

  const hasSub = subEdges.some(({ node: n }) =>
    ['ACTIVE', 'PAUSED'].includes(n.status) &&
    n.lines.edges.some(({ node: l }) => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  const hasOrder = ordEdges.some(({ node: o }) =>
    o.lineItems.edges.some(({ node: l }) => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  console.log('Access result:', JSON.stringify({
    hasSub, hasOrder,
    subs:   subEdges.map(({ node: n }) => ({ status: n.status, lines: n.lines.edges.map(e => e.node.title) })),
    orders: ordEdges.map(({ node: o }) => o.lineItems.edges.map(e => e.node.title)),
  }));

  return res.status(200).json({
    token:           tokens.access_token,
    expiresAt,
    email:           cust.emailAddress?.emailAddress ?? email,
    firstName:       cust.firstName ?? '',
    hasSubscription: hasSub || hasOrder,
  });
}
