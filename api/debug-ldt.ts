import type { VercelRequest, VercelResponse } from '@vercel/node';

const LDT_ACCESS = process.env.LDT_ACCESS ?? '';
const LDT_API_URL = 'https://digital.ldtsoft.work/api/integrate';

async function tryAuth(email: string, label: string, headers: Record<string, string>, url?: string) {
  const fetchUrl = url ?? `${LDT_API_URL}/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=20`;
  try {
    const r = await fetch(fetchUrl, { headers });
    const text = await r.text();
    return { label, status: r.status, body: text.slice(0, 200) };
  } catch (e) {
    return { label, status: 0, body: String(e) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const email = String(req.query.email ?? '');
  if (!email) return res.status(400).json({ error: 'email required' });

  const results = await Promise.all([
    tryAuth(email, 'Bearer', { 'Authorization': `Bearer ${LDT_ACCESS}` }),
    tryAuth(email, 'Raw token', { 'Authorization': LDT_ACCESS }),
    tryAuth(email, 'X-Access-Key', { 'X-Access-Key': LDT_ACCESS }),
    tryAuth(email, 'X-Api-Key', { 'X-Api-Key': LDT_ACCESS }),
    tryAuth(email, 'access_key query param', {},
      `${LDT_API_URL}/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=20&access_key=${encodeURIComponent(LDT_ACCESS)}`),
    tryAuth(email, 'api_key query param', {},
      `${LDT_API_URL}/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=20&api_key=${encodeURIComponent(LDT_ACCESS)}`),
  ]);

  return res.status(200).json({ tokenPresent: !!LDT_ACCESS, results });
}
