import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLIENT_ID    = process.env.customer!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';

const PRODUCT_KEYWORD = (process.env.SHOPIFY_PRODUCT_TITLE ?? 'autothresh').toLowerCase();

// Customer Account API — authenticated with the customer's own OAuth access token
const CUST_API_URL = `https://shopify.com/authentication/${STORE_ID}/account/customer/api/2024-10/graphql`;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function customerApiQuery(accessToken: string, query: string) {
  const r = await fetch(CUST_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query }),
  });
  return r.json() as Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>;
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
  const tokenRes = await fetch(
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

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('Token exchange failed:', err);
    return res.status(401).json({ error: 'Token exchange failed' });
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    id_token:     string;
    expires_in:   number;
  };

  // ── 2. Get email from id_token ────────────────────────────────────────────
  const claims    = decodeJwtPayload(tokens.id_token);
  const email     = claims.email as string;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // ── 3. Query Customer Account API with the customer's own token ───────────
  const custData = await customerApiQuery(tokens.access_token, `
    query {
      customer {
        firstName
        emailAddress { emailAddress }
        orders(first: 20) {
          nodes {
            lineItems(first: 10) {
              nodes { title }
            }
          }
        }
        subscriptionContracts(first: 20) {
          nodes {
            status
            lines(first: 10) {
              nodes { title }
            }
          }
        }
      }
    }
  `);

  console.log('Customer API response:', JSON.stringify(custData));

  type CustNode = {
    firstName: string;
    emailAddress?: { emailAddress: string };
    orders: { nodes: { lineItems: { nodes: { title: string }[] } }[] };
    subscriptionContracts: { nodes: { status: string; lines: { nodes: { title: string }[] } }[] };
  };

  const cust = (custData.data as { customer?: CustNode })?.customer;

  if (!cust) {
    console.error('No customer data from Customer Account API. Errors:', JSON.stringify(custData.errors));
    return res.status(200).json({
      token: tokens.access_token, expiresAt,
      email, firstName: '', hasSubscription: false,
    });
  }

  console.log('Subs:', JSON.stringify(cust.subscriptionContracts.nodes.map(n => ({
    status: n.status, lines: n.lines.nodes.map(l => l.title)
  }))));
  console.log('Orders:', JSON.stringify(cust.orders.nodes.map(o =>
    o.lineItems.nodes.map(l => l.title)
  )));

  // Active or paused subscription with AutoThresh in the title
  const hasSub = cust.subscriptionContracts.nodes.some(n =>
    ['ACTIVE', 'PAUSED'].includes(n.status) &&
    n.lines.nodes.some(l => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  // Fallback: any order containing the product
  const hasOrder = cust.orders.nodes.some(o =>
    o.lineItems.nodes.some(l => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  return res.status(200).json({
    token:           tokens.access_token,
    expiresAt,
    email:           cust.emailAddress?.emailAddress ?? email,
    firstName:       cust.firstName,
    hasSubscription: hasSub || hasOrder,
  });
}
