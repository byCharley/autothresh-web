import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SECRET       = process.env.LICENSE_TOKEN_SECRET || SERVICE_KEY || 'at-trial';
export const TRIAL_MS = 3 * 86_400_000;
/** Household can share Wi‑Fi; burner emails on the same network cannot. */
export const MAX_TRIALS_PER_NETWORK = 2;
const COOKIE = 'at_tid';

export type TrialIdent = { kind: 'device' | 'ip' | 'fp' | 'cookie'; value: string };
export type TrialRow = { id: string; started_at: string; expires_at: string };
export type TrialClaimResult =
  | { status: 'active'; expiresAt: string; startedAt: string; trialId: string }
  | { status: 'expired'; expiresAt: string; startedAt: string; trialId: string }
  | { status: 'none' }
  | { status: 'network_limit' };

function hashIdent(value: string): string {
  return createHash('sha256').update(`${SECRET}|${value}`).digest('hex');
}

/** Stable lock for a verified Shopify customer (not a typed email). */
export function shopifyAccountIdent(emailLower: string): TrialIdent {
  return { kind: 'fp', value: hashIdent(`shopify:${emailLower.trim().toLowerCase()}`) };
}

export function clientIp(req: VercelRequest): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '');
  const first = forwarded.split(',')[0]?.trim();
  return first || String(req.headers['x-real-ip'] ?? '') || req.socket?.remoteAddress || '';
}

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

/**
 * Unique-per-trial network marks (kind fp) so one IP can count toward multiple
 * household trials without the old unique-ip primary-key collision.
 */
function networkSlotIdents(ip: string, trialId: string): TrialIdent[] {
  if (!ip || !trialId) return [];
  const idents: TrialIdent[] = [
    { kind: 'fp', value: `n${hashIdent(ip)}:${trialId}` },
  ];
  const home = ipv6HomePrefix(ip);
  if (home) idents.push({ kind: 'fp', value: `h${hashIdent(`home6:${home}`)}:${trialId}` });
  return idents;
}

function networkSlotPrefixes(ip: string): string[] {
  if (!ip) return [];
  const prefixes = [`n${hashIdent(ip)}:`];
  const home = ipv6HomePrefix(ip);
  if (home) prefixes.push(`h${hashIdent(`home6:${home}`)}:`);
  return prefixes;
}

export function cookieId(req: VercelRequest): string {
  const raw = String(req.headers.cookie ?? '');
  const m = /(?:^|;\s*)at_tid=([0-9a-f-]{36})/i.exec(raw);
  return m?.[1] ?? '';
}

export function setTrialCookie(req: VercelRequest, res: VercelResponse, id: string) {
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
  const active = trials.filter(t => Date.parse(t.expires_at) > now);
  const pool = active.length ? active : trials;
  return pool.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))[0];
}

export async function findTrials(idents: TrialIdent[]): Promise<TrialRow[]> {
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

export async function attachIdents(trialId: string, idents: TrialIdent[]) {
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

/** Browser/device signals for Continue — not used to merge household accounts. */
export function buildDeviceIdents(opts: {
  req: VercelRequest;
  deviceId?: string;
  fingerprint?: string;
}): TrialIdent[] {
  const idents: TrialIdent[] = [];
  const tid = cookieId(opts.req);
  if (tid) idents.push({ kind: 'cookie', value: tid });
  const deviceId = String(opts.deviceId ?? '').trim().slice(0, 80);
  if (deviceId && deviceId !== 'unknown-device') idents.push({ kind: 'device', value: hashIdent(deviceId) });
  const fingerprint = String(opts.fingerprint ?? '').trim().toLowerCase();
  if (fingerprint && /^[a-f0-9]{16,64}$/.test(fingerprint)) {
    idents.push({ kind: 'fp', value: fingerprint });
  }
  return idents;
}

/** How many distinct trials already started from this network (IP / home IPv6). */
export async function countNetworkTrials(req: VercelRequest): Promise<number> {
  const ip = clientIp(req);
  const prefixes = networkSlotPrefixes(ip);
  if (!prefixes.length) return 0;

  const ids = new Set<string>();
  for (const prefix of prefixes) {
    const listed = await sb(
      `app_trial_idents?kind=eq.fp&value=like.${encodeURIComponent(prefix)}*&select=trial_id`,
    );
    if (!listed.ok) {
      console.error('network trial count failed:', listed.status, await listed.text());
      continue;
    }
    const rows = await listed.json() as Array<{ trial_id: string }>;
    for (const row of rows) ids.add(row.trial_id);
  }

  // Also count legacy unique `ip` idents from older builds.
  const legacy = await findTrials([
    { kind: 'ip', value: hashIdent(ip) },
    ...((() => {
      const home = ipv6HomePrefix(ip);
      return home ? [{ kind: 'ip' as const, value: hashIdent(`home6:${home}`) }] : [];
    })()),
  ]);
  for (const t of legacy) ids.add(t.id);

  return ids.size;
}

function toClaimResult(trial: TrialRow): TrialClaimResult {
  const active = Date.parse(trial.expires_at) > Date.now();
  return {
    status: active ? 'active' : 'expired',
    expiresAt: trial.expires_at,
    startedAt: trial.started_at,
    trialId: trial.id,
  };
}

async function bindAndReturn(
  trial: TrialRow,
  attach: TrialIdent[],
  opts?: { req?: VercelRequest; res?: VercelResponse },
): Promise<TrialClaimResult> {
  const cookieIdent: TrialIdent = { kind: 'cookie', value: trial.id };
  const network = opts?.req ? networkSlotIdents(clientIp(opts.req), trial.id) : [];
  await attachIdents(trial.id, [...attach.filter(i => i.kind !== 'cookie'), ...network, cookieIdent]);
  if (opts?.req && opts?.res) setTrialCookie(opts.req, opts.res, trial.id);
  return toClaimResult(trial);
}

/**
 * Resume a trial from this browser only (cookie / device / fingerprint).
 */
export async function lookupAppTrial(
  idents: TrialIdent[],
  opts?: { req?: VercelRequest; res?: VercelResponse },
): Promise<TrialClaimResult> {
  const existing = await findTrials(idents);
  if (!existing.length) return { status: 'none' };
  return bindAndReturn(pickTrial(existing), idents, opts);
}

/**
 * Start or resume a trial for a verified Shopify customer.
 * Resume is account-only. New starts also enforce a per-network cap so
 * burner emails on the same Wi‑Fi cannot mint endless trials.
 */
export async function claimAppTrialForShopify(
  emailLower: string,
  deviceIdents: TrialIdent[],
  opts?: { req?: VercelRequest; res?: VercelResponse; createIfMissing?: boolean },
): Promise<TrialClaimResult> {
  const email = emailLower.trim().toLowerCase();
  if (!email) return { status: 'none' };
  const account = shopifyAccountIdent(email);
  const existing = await findTrials([account]);
  if (existing.length) {
    return bindAndReturn(pickTrial(existing), [...deviceIdents, account], opts);
  }
  if (opts?.createIfMissing === false) return { status: 'none' };

  if (opts?.req) {
    const used = await countNetworkTrials(opts.req);
    if (used >= MAX_TRIALS_PER_NETWORK) {
      return { status: 'network_limit' };
    }
  }

  const expiresAt = new Date(Date.now() + TRIAL_MS).toISOString();
  const created = await sb('app_trials', 'POST', { expires_at: expiresAt });
  if (!created.ok) {
    console.error('app_trials insert failed:', created.status, await created.text());
    throw new Error('create');
  }
  const rows = await created.json() as TrialRow[];
  const trial = rows[0];
  if (!trial) throw new Error('create');
  return bindAndReturn(trial, [...deviceIdents, account], opts);
}

/** Resume an existing Shopify-bound trial without creating a new one. */
export async function resumeAppTrialForShopify(
  emailLower: string,
  deviceIdents: TrialIdent[],
  opts?: { req?: VercelRequest; res?: VercelResponse },
): Promise<TrialClaimResult> {
  return claimAppTrialForShopify(emailLower, deviceIdents, {
    ...opts,
    createIfMissing: false,
  });
}

export function trialConfigured(): boolean {
  return !!(SUPABASE_URL && SERVICE_KEY);
}
