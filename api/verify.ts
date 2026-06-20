import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID        = process.env.SHOPIFY_STORE_ID!;
const STORE_DOMAIN    = process.env.SHOPIFY_STORE_DOMAIN!;
const ADM_TOKEN       = process.env.shopify_private_access_token!;
const ADM_URL         = `https://${STORE_DOMAIN}/admin/api/2024-10/graphql.json`;
const PRODUCT_KEYWORD = (process.env.SHOPIFY_PRODUCT_TITLE ?? 'autothresh').toLowerCase();

const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

async function adminCheckSubscription(email: string): Promise<{ hasSub: boolean; nextBillingDate?: string }> {
  try {
    const r = await fetch(ADM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ADM_TOKEN },
      body: JSON.stringify({
        query: `query($q: String!) {
          customers(first: 1, query: $q) {
            edges { node {
              subscriptionContracts(first: 20) {
                edges { node {
                  status
                  nextBillingDate
                  lines(first: 10) { edges { node { title } } }
                } }
              }
            } }
          }
        }`,
        variables: { q: `email:${email}` },
      }),
    });
    const body = await r.json() as { data?: { customers?: { edges: { node: { subscriptionContracts: { edges: { node: { status: string; nextBillingDate?: string; lines: { edges: { node: { title: string } }[] } } }[] } } }[] } } };
    const cust = body?.data?.customers?.edges?.[0]?.node;
    if (!cust) return { hasSub: false };
    let nextBillingDate: string | undefined;
    const hasSub = cust.subscriptionContracts.edges.some(({ node: n }) => {
      const match = ['ACTIVE', 'PAUSED'].includes(n.status) &&
        n.lines.edges.some(({ node: l }) => l.title.toLowerCase().includes(PRODUCT_KEYWORD));
      if (match && n.nextBillingDate) nextBillingDate = n.nextBillingDate;
      return match;
    });
    return { hasSub, nextBillingDate };
  } catch { return { hasSub: false }; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ valid: false, error: 'Token required' });

  let custData: { data?: Record<string, unknown>; errors?: unknown[] } = {};
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
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
                      edges { node { title } }
                    }
                  }
                }
              }
            }
          }
        `,
      }),
    });
    custData = JSON.parse(await r.text());
  } catch (e) {
    console.error('verify customerApiQuery error:', e);
    return res.status(200).json({ valid: false });
  }

  type LineEdge = { node: { title: string } };
  type SubNode  = { status: string; lines: { edges: LineEdge[] } };
  type CustNode = {
    firstName?: string;
    emailAddress?: { emailAddress: string };
    subscriptionContracts?: { edges: { node: SubNode }[] };
  };

  const cust = (custData.data as { customer?: CustNode })?.customer;
  if (!cust) return res.status(200).json({ valid: false });

  const subEdges = cust.subscriptionContracts?.edges ?? [];

  const hasSub = subEdges.some(({ node: n }) =>
    ['ACTIVE', 'PAUSED'].includes(n.status) &&
    n.lines.edges.some(({ node: l }) => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  const email = cust.emailAddress?.emailAddress ?? '';
  let finalHasSub = hasSub;
  let subscriptionExpiresAt: string | undefined;
  if (!finalHasSub) {
    const adminResult = await adminCheckSubscription(email);
    finalHasSub = adminResult.hasSub;
    subscriptionExpiresAt = adminResult.nextBillingDate;
  }

  return res.status(200).json({
    valid:                true,
    hasSubscription:      finalHasSub,
    subscriptionExpiresAt,
    email,
    firstName:            cust.firstName ?? '',
  });
}
