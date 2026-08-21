import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORE_ID       = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL   = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);
const BUCKET = 'chat-images';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg':                       'jpg',
  'image/jpg':                        'jpg',
  'image/png':                        'png',
  'image/gif':                        'gif',
  'image/webp':                       'webp',
  'image/heic':                       'heic',
  'image/heif':                       'heif',
  'image/tiff':                       'tiff',
  'image/vnd.adobe.photoshop':        'psd',
  'application/photoshop':            'psd',
  'application/psd':                  'psd',
  'image/photoshop':                  'psd',
  'application/postscript':           'ai',
  'application/illustrator':          'ai',
  'application/vnd.adobe.illustrator':'ai',
  'image/x-eps':                      'ai',
};

const EXT_FROM_NAME: Record<string, string> = {
  jpg: 'jpg', jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp',
  heic: 'heic', heif: 'heif', tif: 'tiff', tiff: 'tiff', psd: 'psd', ai: 'ai',
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

function extFor(mimeType: string, fileName?: string): string | null {
  const fromMime = ALLOWED_TYPES[mimeType];
  if (fromMime) return fromMime;
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  return EXT_FROM_NAME[ext] ?? null;
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

  const body = (req.body ?? {}) as {
    action?: string;
    imageData?: string;
    mimeType?: string;
    ticketId?: string;
    fileName?: string;
  };

  const mimeType = body.mimeType ?? '';
  const ticketId = body.ticketId;
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });

  const ext = extFor(mimeType, body.fileName);
  if (!ext) return res.status(400).json({ error: 'Unsupported file type. Use JPG, PNG, GIF, WebP, TIFF, PSD, or AI.' });

  const path = `${ticketId}/${Date.now()}.${ext}`;

  // Direct-to-storage URL for files too large for the Vercel JSON body limit.
  if (body.action === 'sign') {
    const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 180 }),
    });
    const signed = await sign.json() as { url?: string; error?: string };
    if (!sign.ok || !signed.url) {
      console.error('Supabase signed upload error:', signed);
      return res.status(500).json({ error: 'Upload failed' });
    }
    const uploadUrl = signed.url.startsWith('http')
      ? signed.url
      : `${SUPABASE_URL}/storage/v1${signed.url.startsWith('/') ? '' : '/'}${signed.url}`;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    return res.status(200).json({ uploadUrl, publicUrl, path });
  }

  const { imageData } = body;
  if (!imageData) {
    return res.status(400).json({ error: 'imageData, mimeType, and ticketId are required' });
  }

  const buffer = Buffer.from(imageData, 'base64');
  if (buffer.byteLength > MAX_BYTES) return res.status(400).json({ error: 'File too large (max 20 MB)' });

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': mimeType || `image/${ext}`,
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
