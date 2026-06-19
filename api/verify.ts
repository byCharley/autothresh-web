import type { VercelRequest, VercelResponse } from '@vercel/node';

const ADM_TOKEN    = process.env.shopify_private_access_token!;
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const ADM_URL      = `https://${STORE_DOMAIN}/admin/api/2024-10/graphql.json`;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch { return null; }
}

async function adminQuery(query: string, variables: Record<string, unknown>) {
  const r = await fetch(ADM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADM_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json() as Promise<{ data?: Record<string, unknown> }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ valid: false, error: 'Token required' });

  // ── 1. Decode JWT — check expiry ──────────────────────────────────────────
  const claims = decodeJwtPayload(token);
  if (!claims) return res.status(200).json({ valid: false });

  const exp = claims.exp as number | undefined;
  if (exp && exp * 1000 < Date.now()) return res.status(200).json({ valid: false });

  const customerGid = claims.sub as string;
  if (!customerGid) return res.status(200).json({ valid: false });

  // ── 2. Admin API — recheck subscription ───────────────────────────────────
  const admData = await adminQuery(`
    query GetCustomer($id: ID!) {
      customer(id: $id) {
        firstName
        email
        subscriptionContracts(first: 10) {
          edges { node { status } }
        }
      }
    }
  `, { id: customerGid });

  const cust = (admData.data as {
    customer?: { firstName: string; email: string; subscriptionContracts: { edges: { node: { status: string } }[] } }
  })?.customer;

  if (!cust) return res.status(200).json({ valid: false });

  const hasSubscription = cust.subscriptionContracts.edges.some((e) => e.node.status === 'ACTIVE');

  return res.status(200).json({
    valid: true,
    hasSubscription,
    email:     cust.email,
    firstName: cust.firstName,
  });
}
