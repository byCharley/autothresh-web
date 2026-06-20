import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLIENT_ID    = process.env.customer!;
const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const ADM_TOKEN    = process.env.shopify_private_access_token!;
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI ?? 'https://www.autothresh.com/auth/callback';

const PRODUCT_KEYWORD = (process.env.SHOPIFY_PRODUCT_TITLE ?? 'autothresh').toLowerCase();
const ADM_URL = `https://${STORE_DOMAIN}/admin/api/2024-10/graphql.json`;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function adminQuery(query: string, variables: Record<string, unknown>) {
  const r = await fetch(ADM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADM_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json() as Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>;
}

type SubEdge = { node: { status: string; lines: { edges: { node: { title: string } }[] } } };
type OrdEdge = { node: { lineItems: { edges: { node: { title: string } }[] } } };

// Accept ACTIVE or PAUSED selling-plan subscriptions as valid access
const VALID_SUB_STATUSES = new Set(['ACTIVE', 'PAUSED']);

function hasAutoThreshAccess(subEdges: SubEdge[], ordEdges: OrdEdge[]): boolean {
  const activeSub = subEdges.some(({ node }) =>
    VALID_SUB_STATUSES.has(node.status) &&
    node.lines.edges.some(({ node: line }) =>
      line.title.toLowerCase().includes(PRODUCT_KEYWORD)
    )
  );
  if (activeSub) return true;

  // Fallback: any paid order containing the product (covers one-time / lifetime)
  return ordEdges.some(({ node: order }) =>
    order.lineItems.edges.some(({ node: item }) =>
      item.title.toLowerCase().includes(PRODUCT_KEYWORD)
    )
  );
}

const CUSTOMER_QUERY = `
  query GetCustomerByEmail($query: String!) {
    customers(first: 1, query: $query) {
      edges {
        node {
          id
          firstName
          subscriptionContracts(first: 20) {
            edges {
              node {
                status
                lines(first: 10) {
                  edges { node { title } }
                }
              }
            }
          }
          orders(first: 20, query: "financial_status:paid status:any") {
            edges {
              node {
                lineItems(first: 10) {
                  edges { node { title } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

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

  // ── 2. Get email from id_token JWT ────────────────────────────────────────
  const claims  = decodeJwtPayload(tokens.id_token);
  const email   = claims.email as string;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  console.log('JWT email:', email, '| sub:', claims.sub);

  if (!email) {
    return res.status(401).json({ error: 'No email in token' });
  }

  // ── 3. Admin API — look up by email (avoids GID format issues) ────────────
  const admData = await adminQuery(CUSTOMER_QUERY, { query: `email:${email}` });

  type CustNode = {
    id: string;
    firstName: string;
    subscriptionContracts: { edges: SubEdge[] };
    orders: { edges: OrdEdge[] };
  };
  type CustData = { customers?: { edges: { node: CustNode }[] } };

  const cust = (admData.data as CustData)?.customers?.edges[0]?.node;
  console.log('Customer found:', cust?.id ?? 'NOT FOUND');
  console.log('Subs:', JSON.stringify(cust?.subscriptionContracts.edges.map(e => ({
    status: e.node.status,
    lines: e.node.lines.edges.map(l => l.node.title),
  }))));
  console.log('Orders:', JSON.stringify(cust?.orders.edges.map(o =>
    o.node.lineItems.edges.map(l => l.node.title)
  )));

  const firstName       = cust?.firstName ?? '';
  const hasSubscription = cust
    ? hasAutoThreshAccess(cust.subscriptionContracts.edges, cust.orders.edges)
    : false;

  return res.status(200).json({
    token: tokens.access_token,
    expiresAt,
    email,
    firstName,
    hasSubscription,
  });
}
