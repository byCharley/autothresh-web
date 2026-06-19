import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE   = process.env.SHOPIFY_STORE_DOMAIN!;
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

function hasActive(contracts: { node: { status: string } }[]): boolean {
  return contracts.some((e) => e.node.status === 'ACTIVE');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  // ── 1. Authenticate customer via Storefront API ────────────────────────────
  const authData = await storefront(`
    mutation Login($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken { accessToken expiresAt }
        customerUserErrors { code message }
      }
    }
  `, { input: { email, password } });

  const result = (authData.data as { customerAccessTokenCreate?: { customerAccessToken?: { accessToken: string; expiresAt: string }; customerUserErrors?: { message: string }[] } })?.customerAccessTokenCreate;
  if (result?.customerUserErrors?.length) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const { accessToken, expiresAt } = result?.customerAccessToken ?? {};
  if (!accessToken) return res.status(401).json({ error: 'Login failed' });

  // ── 2. Get customer GID ────────────────────────────────────────────────────
  const custData = await storefront(`
    query GetCustomer($token: String!) {
      customer(customerAccessToken: $token) { id email firstName }
    }
  `, { token: accessToken });

  const customer = (custData.data as { customer?: { id: string; email: string; firstName: string } })?.customer;
  if (!customer) return res.status(401).json({ error: 'Customer not found' });

  // ── 3. Check subscription contracts via Admin API ─────────────────────────
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

  return res.status(200).json({
    token:           accessToken,
    expiresAt,
    email:           customer.email,
    firstName:       customer.firstName,
    hasSubscription: hasActive(edges),
  });
}
