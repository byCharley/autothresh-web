import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../lib/db';
import { verifyToken } from '../lib/verifyToken';

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization ?? '';
  const email = await verifyToken(token);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.query;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });

  // ── DELETE ──────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('presets')
      .delete()
      .eq('id', id)
      .eq('user_email', email); // security: users can only delete their own presets
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
