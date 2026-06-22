import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './lib/db';
import { verifyToken } from './lib/verifyToken';

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization ?? '';
  const email = await verifyToken(token);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    try {
      const data = await db.getPresets(email);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }

  if (req.method === 'POST') {
    const { name, data } = req.body as { name?: string; data?: unknown };
    if (!name?.trim() || !data) return res.status(400).json({ error: 'name and data required' });
    try {
      const row = await db.createPreset(email, name.trim(), data);
      return res.status(201).json(row);
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
