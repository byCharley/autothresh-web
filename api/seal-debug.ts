import type { VercelRequest, VercelResponse } from '@vercel/node';

// TEMPORARY debug endpoint — delete after Seal integration is confirmed working
// Usage: POST /api/seal-debug with body { "email": "info@charleypangus.com" }

const SEAL_TOKEN   = process.env.SEAL_API_TOKEN!;
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = (req.body as { email?: string })?.email ?? 'info@charleypangus.com';
  const url   = `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`;

  let httpStatus = 0;
  let rawText    = '';
  let parsed: unknown = null;
  let parseError = '';

  try {
    const r  = await fetch(url, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
    httpStatus = r.status;
    rawText    = await r.text();
    try { parsed = JSON.parse(rawText); } catch (e) { parseError = String(e); }
  } catch (e) {
    return res.status(200).json({ error: String(e), tokenPresent: !!SEAL_TOKEN });
  }

  return res.status(200).json({
    tokenPresent: !!SEAL_TOKEN,
    url,
    httpStatus,
    rawText: rawText.slice(0, 2000),
    parsed,
    parseError: parseError || undefined,
  });
}
