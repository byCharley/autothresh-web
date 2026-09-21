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

/** First 4 IPv6 groups (/64). Devices on the same home network share this. */
function ipv6HomePrefix(ip: string): string | null {
  if (!ip.includes(':')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':').filter(Boolean) : []) : null;
  const parts = tail === null
    ? head
    : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  if (parts.length !== 8) return null;
  return parts.slice(0, 4).join(':');
}

function ipIdents(ip: string): Ident[] {
  if (!ip) return [];
  const idents: Ident[] = [{ kind: 'ip', value: hashIdent(ip) }];
  const home = ipv6HomePrefix(ip);
  if (home) idents.push({ kind: 'ip', value: hashIdent(`home6:${home}`) });
  return idents;
}

function hashIdent(value: string): string {
  return createHash('sha256').update(`${SECRET}|${value}`).digest('hex');
}

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
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
  // Prefer an active trial; otherwise the earliest started (so we never "restart").
  const active = trials.filter(t => Date.parse(t.expires_at) > now);
  const pool = active.length ? active : trials;
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

  const body = (req.body ?? {}) as { deviceId?: string; fingerprint?: string; email?: string };
  const deviceId = String(body.deviceId ?? '').trim().slice(0, 80);
  const fingerprint = String(body.fingerprint ?? '').trim().toLowerCase();
  const email = normalizeEmail(String(body.email ?? ''));
  if (fingerprint && !/^[a-f0-9]{16,64}$/.test(fingerprint)) {
    return res.status(400).json({ error: 'Invalid fingerprint.' });
  }

  const idents: Ident[] = [];
  const tid = cookieId(req);
  if (tid) idents.push({ kind: 'cookie', value: tid });
  if (deviceId && deviceId !== 'unknown-device') idents.push({ kind: 'device', value: hashIdent(deviceId) });
  if (fingerprint) idents.push({ kind: 'fp', value: fingerprint });
  // Email lock (works across VPN / phones). Stored as an fp-ident so we do not
  // need a DB schema change on existing installs.
  if (email) idents.push({ kind: 'fp', value: hashIdent(`email:${email}`) });
  const ip = clientIp(req);
  idents.push(...ipIdents(ip));
  if (!idents.length) return res.status(400).json({ error: 'Could not start trial.' });

  const lookupOnly = req.query.action === 'status';

  try {
    const existing = await findTrials(idents);
    if (!existing.length) {
      if (lookupOnly) return res.status(200).json({ status: 'none' });
      // New trials must be tied to an email so phones/VPNs cannot mint extras.
      if (!email) {
        return res.status(400).json({ error: 'Enter your email to start the free trial.', needEmail: true });
      }
      const expiresAt = new Date(Date.now() + TRIAL_MS).toISOString();
      const created = await sb('app_trials', 'POST', { expires_at: expiresAt });
      if (!created.ok) {
        console.error('app_trials insert failed:', created.status, await created.text());
        return res.status(500).json({ error: 'Could not start trial.' });
      }
      const rows = await created.json() as TrialRow[];
      const trial = rows[0];
      if (!trial) return res.status(500).json({ error: 'Could not start trial.' });
      const cookieIdent: Ident = { kind: 'cookie', value: trial.id };
      await attachIdents(trial.id, [...idents.filter(i => i.kind !== 'cookie'), cookieIdent]);
      setTrialCookie(req, res, trial.id);
      return res.status(200).json({
        status: 'active',
        expiresAt: trial.expires_at,
        startedAt: trial.started_at,
      });
    }

    const trial = pickTrial(existing);
    // Link this device / email / network to the trial that already exists.
    // Never insert a second trial.
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
