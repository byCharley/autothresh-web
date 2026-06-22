import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './lib/db';
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

  // ── GET — list user's presets ───────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('presets')
      .select('id, name, data, created_at, updated_at')
      .eq('user_email', email)
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // ── POST — save new preset ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, data } = req.body as { name?: string; data?: unknown };
    if (!name?.trim() || !data) return res.status(400).json({ error: 'name and data required' });
    const { data: row, error } = await supabase
      .from('presets')
      .insert({ user_email: email, name: name.trim(), data })
      .select('id, name, created_at, updated_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(row);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
