import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SECRET       = process.env.LICENSE_TOKEN_SECRET || SERVICE_KEY || 'at-trial';
const TRIAL_MS     = 3 * 86_400_000;
const COOKIE       = 'at_tid';

type Ident = { kind: 'device' | 'ip' | 'fp' | 'cookie'; value: string };
type TrialRow = { id: string; started_at: string; expires_at: string };

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clientIp(req: VercelRequest): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '');
  const first = forwarded.split(',')[0]?.trim();
  return first || String(req.headers['x-real-ip'] ?? '') || req.socket?.remoteAddress || '';
}

function hashIdent(value: string): string {
  return createHash('sha256').update(`${SECRET}|${value}`).digest('hex');
}

function cookieId(req: VercelRequest): string {
  const raw = String(req.headers.cookie ?? '');
  const m = /(?:^|;\s*)at_tid=([0-9a-f-]{36})/i.exec(raw);
  return m?.[1] ?? '';
}

function setTrialCookie(req: VercelRequest, res: VercelResponse, id: string) {
  const https = req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`);
}

async function sb(path: string, method = 'GET', body?: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Prefer: method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function pickTrial(trials: TrialRow[]): TrialRow {
  const now = Date.now();
  const expired = trials.filter(t => Date.parse(t.expires_at) <= now);
  const pool = expired.length ? expired : trials;
  return pool.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))[0];
}

async function findTrials(idents: Ident[]): Promise<TrialRow[]> {
  if (!idents.length) return [];
  const or = idents.map(i => `and(kind.eq.${i.kind},value.eq.${encodeURIComponent(i.value)})`).join(',');
  const listed = await sb(`app_trial_idents?or=(${or})&select=trial_id`);
  if (!listed.ok) {
    console.error('app_trial_idents load failed:', listed.status, await listed.text());
    throw new Error('idents');
  }
  const rows = await listed.json() as Array<{ trial_id: string }>;
  const ids = [...new Set(rows.map(r => r.trial_id))];
  if (!ids.length) return [];
  const trials = await sb(`app_trials?id=in.(${ids.join(',')})&select=id,started_at,expires_at`);
  if (!trials.ok) {
    console.error('app_trials load failed:', trials.status, await trials.text());
    throw new Error('trials');
  }
  return await trials.json() as TrialRow[];
}

async function attachIdents(trialId: string, idents: Ident[]) {
  for (const ident of idents) {
    const r = await sb('app_trial_idents', 'POST', { trial_id: trialId, kind: ident.kind, value: ident.value });
    if (!r.ok && r.status !== 409) {
      const text = await r.text();
      if (!text.includes('duplicate') && !text.toLowerCase().includes('unique')) {
        console.error('app_trial_idents insert failed:', r.status, text);
      }
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Trial is not configured.' });

  const body = (req.body ?? {}) as { deviceId?: string; fingerprint?: string };
  const deviceId = String(body.deviceId ?? '').trim().slice(0, 80);
  const fingerprint = String(body.fingerprint ?? '').trim().toLowerCase();
  if (fingerprint && !/^[a-f0-9]{16,64}$/.test(fingerprint)) {
    return res.status(400).json({ error: 'Invalid fingerprint.' });
  }

  const idents: Ident[] = [];
  const tid = cookieId(req);
  if (tid) idents.push({ kind: 'cookie', value: tid });
  if (deviceId && deviceId !== 'unknown-device') idents.push({ kind: 'device', value: hashIdent(deviceId) });
  if (fingerprint) idents.push({ kind: 'fp', value: fingerprint });
  const ip = clientIp(req);
  if (ip) idents.push({ kind: 'ip', value: hashIdent(ip) });
  if (!idents.length) return res.status(400).json({ error: 'Could not start trial.' });

  try {
    const existing = await findTrials(idents);
    let trial: TrialRow;
    if (existing.length) {
      trial = pickTrial(existing);
    } else {
      const expiresAt = new Date(Date.now() + TRIAL_MS).toISOString();
      const created = await sb('app_trials', 'POST', { expires_at: expiresAt });
      if (!created.ok) {
        console.error('app_trials insert failed:', created.status, await created.text());
        return res.status(500).json({ error: 'Could not start trial.' });
      }
      const rows = await created.json() as TrialRow[];
      trial = rows[0];
      if (!trial) return res.status(500).json({ error: 'Could not start trial.' });
    }

    const cookieIdent: Ident = { kind: 'cookie', value: trial.id };
    await attachIdents(trial.id, [...idents.filter(i => i.kind !== 'cookie'), cookieIdent]);
    setTrialCookie(req, res, trial.id);

    const active = Date.parse(trial.expires_at) > Date.now();
    return res.status(200).json({
      status: active ? 'active' : 'expired',
      expiresAt: trial.expires_at,
      startedAt: trial.started_at,
    });
  } catch {
    return res.status(500).json({ error: 'Could not start trial.' });
  }
}
