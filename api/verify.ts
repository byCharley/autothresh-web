import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORE_ID        = process.env.SHOPIFY_STORE_ID!;
const PRODUCT_KEYWORD = (process.env.SHOPIFY_PRODUCT_TITLE ?? 'autothresh').toLowerCase();

const CUST_API_URL = `https://shopify.com/authentication/${STORE_ID}/account/customer/api/2024-10/graphql`;

async function customerApiQuery(accessToken: string, query: string): Promise<{ data?: Record<string, unknown>; errors?: unknown[] }> {
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query }),
    });
    const text = await r.text();
    return JSON.parse(text);
  } catch (e) {
    console.error('customerApiQuery error:', e);
    return {};
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ valid: false, error: 'Token required' });

  // Query Customer Account API using the stored OAuth access token
  const custData = await customerApiQuery(token, `
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

  type CustNode = {
    firstName: string;
    emailAddress?: { emailAddress: string };
    orders: { nodes: { lineItems: { nodes: { title: string }[] } }[] };
    subscriptionContracts: { nodes: { status: string; lines: { nodes: { title: string }[] } }[] };
  };

  const cust = (custData.data as { customer?: CustNode })?.customer;

  if (!cust) {
    // Token may be expired or invalid
    console.error('Verify: no customer data. Errors:', JSON.stringify(custData.errors));
    return res.status(200).json({ valid: false });
  }

  const hasSub = cust.subscriptionContracts.nodes.some(n =>
    ['ACTIVE', 'PAUSED'].includes(n.status) &&
    n.lines.nodes.some(l => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  const hasOrder = cust.orders.nodes.some(o =>
    o.lineItems.nodes.some(l => l.title.toLowerCase().includes(PRODUCT_KEYWORD))
  );

  return res.status(200).json({
    valid:           true,
    hasSubscription: hasSub || hasOrder,
    email:           cust.emailAddress?.emailAddress ?? '',
    firstName:       cust.firstName,
  });
}
