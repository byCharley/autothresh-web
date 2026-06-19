import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE    = process.env.SHOPIFY_STORE_DOMAIN!;
const SF_TOKEN = process.env.storefront!;
const ADM_TOKEN = process.env.shopify_private_access_token!;

const SF_URL  = `https://${STORE}/api/2024-10/graphql.json`;
const ADM_URL = `https://${STORE}/admin/api/2024-10/graphql.json`;

async function storefront(query: string, variables: Record<string, unknown>) {
  const r = await fetch(SF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': SF_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json() as Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>;
}

async function admin(query: string, variables: Record<string, unknown>) {
  const r = await fetch(ADM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADM_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json() as Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ valid: false, error: 'Token required' });

  // ── 1. Re-fetch customer with stored token ─────────────────────────────────
  const custData = await storefront(`
    query GetCustomer($token: String!) {
      customer(customerAccessToken: $token) { id email firstName }
    }
  `, { token });

  const customer = (custData.data as { customer?: { id: string; email: string; firstName: string } })?.customer;
  if (!customer) return res.status(200).json({ valid: false });

  // ── 2. Recheck subscription ────────────────────────────────────────────────
  const subData = await admin(`
    query GetSubs($id: ID!) {
      customer(id: $id) {
        subscriptionContracts(first: 10) {
          edges { node { status } }
        }
      }
    }
  `, { id: customer.id });

  const edges = ((subData.data as { customer?: { subscriptionContracts?: { edges: { node: { status: string } }[] } } })
    ?.customer?.subscriptionContracts?.edges) ?? [];

  const hasSubscription = edges.some((e) => e.node.status === 'ACTIVE');

  return res.status(200).json({
    valid: true,
    hasSubscription,
    email:     customer.email,
    firstName: customer.firstName,
  });
}
