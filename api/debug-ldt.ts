import type { VercelRequest, VercelResponse } from '@vercel/node';

const LDT_ACCESS = process.env.LDT_ACCESS ?? '';
const LDT_API_URL = 'https://digital.ldtsoft.work/api/integrate';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const email = String(req.query.email ?? '');
  if (!email) return res.status(400).json({ error: 'email required' });

  const url = `${LDT_API_URL}/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=20`;
  const r = await fetch(url, { headers: { 'LDT-X-Access-Token': LDT_ACCESS } });
  const raw = await r.text();
  const body = JSON.parse(raw) as unknown;

  let orders: unknown[] = [];
  if (Array.isArray(body)) {
    orders = body;
  } else if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['data', 'orders', 'items', 'result', 'list']) {
      if (Array.isArray(obj[key])) { orders = obj[key] as unknown[]; break; }
    }
  }

  const isWebOrder = (o: unknown) => {
    const json = JSON.stringify(o).toLowerCase().replace(/™/g, '');
    return json.includes('autothresh web') && !json.includes('autothresh pro') && !json.includes('autothresh lite');
  };

  return res.status(200).json({
    httpStatus: r.status,
    totalOrders: orders.length,
    matchedWebOrders: orders.filter(isWebOrder).length,
    allOrders: orders.map((o: unknown) => {
      const obj = o as Record<string, unknown>;
      const items = Array.isArray(obj.items) ? obj.items as Array<Record<string,unknown>> : [];
      return {
        id: obj.id,
        name: obj.name,
        isPaid: obj.isPaid,
        isCancelled: obj.isCancelled,
        items: items.map(i => ({ title: i.title, productName: i.productName, variantName: i.variantName })),
        matchesWebFilter: isWebOrder(o),
      };
    }),
  });
}
