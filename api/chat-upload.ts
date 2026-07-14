import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORE_ID       = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL   = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);
const BUCKET = 'chat-images';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
};

async function identify(token: string): Promise<{ email: string; isCreator: boolean } | null> {
  if (!token) return null;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ query: `query { customer { emailAddress { emailAddress } } }` }),
    });
    const body = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    const email = (body.data?.customer?.emailAddress?.emailAddress ?? '').toLowerCase();
    if (!email) return null;
    return { email, isCreator: CREATOR_EMAILS.has(email) };
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const user = await identify(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { imageData, mimeType, ticketId } = req.body as {
    imageData?: string; // base64
    mimeType?: string;
    ticketId?: string;
  };

  if (!imageData || !mimeType || !ticketId) {
    return res.status(400).json({ error: 'imageData, mimeType, and ticketId are required' });
  }

  const ext = ALLOWED_TYPES[mimeType];
  if (!ext) return res.status(400).json({ error: 'Unsupported image type' });

  const buffer = Buffer.from(imageData, 'base64');
  if (buffer.byteLength > MAX_BYTES) return res.status(400).json({ error: 'Image too large (max 5 MB)' });

  const path = `${ticketId}/${Date.now()}.${ext}`;

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': mimeType,
      'Cache-Control': '3600',
    },
    body: buffer,
  });

  if (!up.ok) {
    const err = await up.text();
    console.error('Supabase storage upload error:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }

  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  return res.status(200).json({ url });
}
