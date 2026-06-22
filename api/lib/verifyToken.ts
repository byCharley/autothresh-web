const STORE_ID     = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;

// Returns the verified email for the token, or null if invalid.
export async function verifyToken(token: string): Promise<string | null> {
  if (!token) return null;
  // Dev bypass — only available in non-production environments
  if (token === 'dev-bypass' && process.env.VERCEL_ENV !== 'production') {
    return 'dev@localhost';
  }
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ query: `query { customer { emailAddress { emailAddress } } }` }),
    });
    const body = await r.json() as {
      data?: { customer?: { emailAddress?: { emailAddress: string } } };
    };
    return body?.data?.customer?.emailAddress?.emailAddress ?? null;
  } catch {
    return null;
  }
}
