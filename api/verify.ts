import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID        = process.env.SHOPIFY_STORE_ID!;
const PRODUCT_KEYWORD = (process.env.SHOPIFY_PRODUCT_TITLE ?? 'autothresh').toLowerCase();

const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

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
              orders(first: 20) {
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
  type OrdNode  = { lineItems: { edges: LineEdge[] } };
  type CustNode = {
    firstName?: string;
    emailAddress?: { emailAddress: string };
    subscriptionContracts?: { edges: { node: SubNode }[] };
    orders?: { edges: { node: OrdNode }[] };
  };

  const cust = (custData.data as { customer?: CustNode })?.customer;
  if (!cust) return res.status(200).json({ valid: false });

  const subEdges = cust.subscriptionContracts?.edges ?? [];
  const ordEdges = cust.orders?.edges ?? [];

  const hasSub = subEdges.some(({ node: n }) =>
    ['ACTIVE', 'PAUSED'].includes(n.status) &&
    n.lines.edges.some(({ node: l }) => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  const hasOrder = ordEdges.some(({ node: o }) =>
    o.lineItems.edges.some(({ node: l }) => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  return res.status(200).json({
    valid:           true,
    hasSubscription: hasSub || hasOrder,
    email:           cust.emailAddress?.emailAddress ?? '',
    firstName:       cust.firstName ?? '',
  });
}
