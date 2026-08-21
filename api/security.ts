import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORE_ID       = process.env.SHOPIFY_STORE_ID!;
const CUST_API_URL   = `https://shopify.com/${STORE_ID}/account/customer/api/2024-07/graphql`;
const CREATOR_EMAILS = new Set(
  (process.env.CREATOR_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
);

function sb(path: string, method = 'GET', body?: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Prefer': method === 'POST' ? 'return=representation' : 'count=planned',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function verifyCreator(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ query: `query { customer { emailAddress { emailAddress } } }` }),
    });
    const body = await r.json() as { data?: { customer?: { emailAddress?: { emailAddress: string } } } };
    const email = body?.data?.customer?.emailAddress?.emailAddress ?? '';
    return CREATOR_EMAILS.has(email.toLowerCase());
  } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const isCreator = await verifyCreator(token);
  if (!isCreator) return res.status(403).json({ error: 'Forbidden' });

  const resource = String(req.query.resource ?? '');

  // ── All users (analytics + testers + suspend flags) ───────────────────────
  if (resource === 'users') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
      const [eventsRes, testersRes, flagsRes] = await Promise.all([
        sb(`analytics_events?select=email,created_at,device_type,country,event_type&created_at=gte.${since}&order=created_at.desc&limit=10000`),
        sb('testers?select=email,status,role'),
        sb('security_flags?select=email,expired,reason,reviewed'),
      ]);

      const events  = eventsRes.ok  ? await eventsRes.json()  as Array<Record<string, unknown>> : [];
      const testers = testersRes.ok ? await testersRes.json() as Array<Record<string, unknown>> : [];
      const flags   = flagsRes.ok   ? await flagsRes.json()   as Array<Record<string, unknown>> : [];

      type Agg = {
        email: string; firstSeen: string; lastSeen: string;
        opens: number; logins: number; device: string; country: string;
      };
      const map = new Map<string, Agg>();
      for (const ev of events) {
        const email = String(ev.email ?? '').toLowerCase().trim();
        if (!email) continue;
        const ts = String(ev.created_at ?? '');
        const existing = map.get(email);
        if (!existing) {
          map.set(email, {
            email,
            firstSeen: ts,
            lastSeen: ts,
            opens: ev.event_type === 'login' ? 0 : 1,
            logins: ev.event_type === 'login' ? 1 : 0,
            device: String(ev.device_type ?? ''),
            country: String(ev.country ?? ''),
          });
        } else {
          existing.opens  += ev.event_type === 'login' ? 0 : 1;
          existing.logins += ev.event_type === 'login' ? 1 : 0;
          if (ts > existing.lastSeen) {
            existing.lastSeen = ts;
            if (ev.device_type) existing.device = String(ev.device_type);
            if (ev.country) existing.country = String(ev.country);
          }
          if (ts && (!existing.firstSeen || ts < existing.firstSeen)) existing.firstSeen = ts;
        }
      }

      const testerByEmail = new Map(testers.map(t => [String(t.email).toLowerCase(), t]));
      const flagByEmail   = new Map(flags.map(f => [String(f.email).toLowerCase(), f]));

      for (const t of testers) {
        const email = String(t.email).toLowerCase();
        if (email && !map.has(email)) {
          map.set(email, { email, firstSeen: '', lastSeen: '', opens: 0, logins: 0, device: '', country: '' });
        }
      }
      for (const f of flags) {
        const email = String(f.email).toLowerCase();
        if (email && !map.has(email)) {
          map.set(email, { email, firstSeen: '', lastSeen: '', opens: 0, logins: 0, device: '', country: '' });
        }
      }

      const users = [...map.values()].map(u => {
        const t = testerByEmail.get(u.email);
        const f = flagByEmail.get(u.email);
        const blocked = Boolean(f?.expired);
        return {
          ...u,
          blocked,
          blockReason: blocked ? String(f?.reason ?? '') : '',
          accessRole: t ? String(t.role ?? 'tester') : null,
          accessStatus: t ? String(t.status ?? '') : null,
        };
      }).sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

      return res.status(200).json({
        users,
        total: users.length,
        blocked: users.filter(u => u.blocked).length,
      });
    } catch (e) {
      console.error('Users GET error:', e);
      return res.status(500).json({ error: 'Failed to load users' });
    }
  }

  // ── Testers resource ──────────────────────────────────────────────────────
  if (resource === 'testers') {
    const TABLE_MISSING = 'testers table not found — run:\n\nCREATE TABLE testers (\n  email text PRIMARY KEY,\n  status text NOT NULL DEFAULT \'active\',\n  role text NOT NULL DEFAULT \'tester\',\n  notes text,\n  created_at timestamptz NOT NULL DEFAULT now()\n);\n\nIf the table exists but is missing the role column, run:\nALTER TABLE testers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT \'tester\';';

    if (req.method === 'GET') {
      try {
        const r = await sb('testers?order=created_at.desc&select=email,status,role,notes,created_at');
        if (!r.ok) {
          const text = await r.text();
          if (r.status === 404 || text.includes('does not exist') || text.includes('relation')) {
            return res.status(200).json({ testers: [], setupRequired: true });
          }
          console.error('Testers GET error:', r.status, text);
          return res.status(500).json({ error: 'Failed to load testers' });
        }
        return res.status(200).json({ testers: await r.json() });
      } catch (e) { console.error('Testers GET error:', e); return res.status(500).json({ error: 'Failed to load testers' }); }
    }

    if (req.method === 'POST') {
      const { action, email, notes, role } = req.body as { action?: string; email?: string; notes?: string; role?: string };
      if (!action || !email) return res.status(400).json({ error: 'action and email required' });
      const em = email.toLowerCase().trim();
      const validRole = (role === 'lifetime' || role === 'tester') ? role : 'tester';
      try {
        if (action === 'add') {
          const r = await sb('testers', 'POST', { email: em, status: 'active', role: validRole, notes: notes ?? null });
          if (!r.ok) {
            const text = await r.text();
            if (text.includes('does not exist') || text.includes('relation')) {
              return res.status(500).json({ error: TABLE_MISSING });
            }
            console.error('Testers add error:', r.status, text);
            return res.status(500).json({ error: `Failed to add tester: ${r.status}` });
          }
          return res.status(200).json({ ok: true });
        }
        if (action === 'pause')  { const r = await sb(`testers?email=eq.${encodeURIComponent(em)}`, 'PATCH', { status: 'paused' }); if (!r.ok) return res.status(500).json({ error: 'Failed' }); return res.status(200).json({ ok: true }); }
        if (action === 'resume') { const r = await sb(`testers?email=eq.${encodeURIComponent(em)}`, 'PATCH', { status: 'active' }); if (!r.ok) return res.status(500).json({ error: 'Failed' }); return res.status(200).json({ ok: true }); }
        if (action === 'remove') { await sb(`testers?email=eq.${encodeURIComponent(em)}`, 'DELETE'); return res.status(200).json({ ok: true }); }
        return res.status(400).json({ error: 'Unknown action' });
      } catch (e) { console.error('Testers POST error:', e); return res.status(500).json({ error: 'Action failed' }); }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── GET: return flags + summary stats ────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const [flagsRes, recentRes] = await Promise.all([
        sb('security_flags?order=created_at.desc&limit=200'),
        sb(`security_events?select=email,ip,created_at&created_at=gte.${new Date(Date.now() - 7 * 86_400_000).toISOString()}&limit=5000`),
      ]);

      const flags = flagsRes.ok ? await flagsRes.json() as Array<Record<string, unknown>> : [];
      const recent = recentRes.ok ? await recentRes.json() as Array<Record<string, unknown>> : [];

      // Build IP → { email → firstSeen } map from recent events
      const ipEmailFirstSeen = new Map<string, Map<string, string>>();
      for (const ev of recent) {
        const ip    = String(ev.ip ?? '');
        const email = String(ev.email ?? '').toLowerCase();
        const ts    = String(ev.created_at ?? '');
        if (!ip || !email || !ts) continue;
        if (!ipEmailFirstSeen.has(ip)) ipEmailFirstSeen.set(ip, new Map());
        const emailMap = ipEmailFirstSeen.get(ip)!;
        if (!emailMap.has(email) || ts < emailMap.get(email)!) emailMap.set(email, ts);
      }
      const sharedIps = [...ipEmailFirstSeen.entries()]
        .filter(([, emailMap]) => emailMap.size > 1)
        .map(([ip, emailMap]) => ({
          ip,
          emails: [...emailMap.entries()]
            .sort(([, a], [, b]) => a.localeCompare(b)) // oldest signup first
            .map(([email, firstSeen]) => ({ email, firstSeen })),
        }))
        .sort((a, b) => b.emails.length - a.emails.length);

      const unreviewed = flags.filter(f => !f.reviewed && !f.expired).length;
      const expired    = flags.filter(f => f.expired).length;
      const highConf   = flags.filter(f => f.confidence === 'high').length;

      return res.status(200).json({
        flags,
        sharedIps,
        summary: {
          total: flags.length,
          unreviewed,
          expired,
          highConfidence: highConf,
          sharedIpsLast7d: sharedIps.length,
        },
      });
    } catch (e) {
      console.error('Security GET error:', e);
      return res.status(500).json({ error: 'Failed to load security data' });
    }
  }

  // ── POST: take action on a flag ────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, email, notes } = req.body as { action?: string; email?: string; notes?: string };
    if (!action || !email) return res.status(400).json({ error: 'action and email required' });

    try {
      if (action === 'expire') {
        // Upsert: works whether the user is already flagged or brand new
        const r = await sb('security_flags', 'POST', {
          email: email.toLowerCase(),
          reason: notes ?? 'Manually blocked by creator',
          confidence: 'high',
          auto_flagged: false,
          reviewed: true,
          expired: true,
        });
        if (!r.ok) {
          // Row already exists — patch it instead
          await sb(
            `security_flags?email=eq.${encodeURIComponent(email.toLowerCase())}`,
            'PATCH',
            { expired: true, reviewed: true, notes: notes ?? null },
          );
        }
        return res.status(200).json({ ok: true });
      }

      if (action === 'unblock') {
        await sb(
          `security_flags?email=eq.${encodeURIComponent(email)}`,
          'PATCH',
          { expired: false, reviewed: true, notes: notes ?? null },
        );
        return res.status(200).json({ ok: true });
      }

      if (action === 'unflag') {
        await sb(
          `security_flags?email=eq.${encodeURIComponent(email)}`,
          'DELETE',
        );
        return res.status(200).json({ ok: true });
      }

      if (action === 'review') {
        await sb(
          `security_flags?email=eq.${encodeURIComponent(email)}`,
          'PATCH',
          { reviewed: true, notes: notes ?? null },
        );
        return res.status(200).json({ ok: true });
      }

      if (action === 'flag') {
        await sb('security_flags', 'POST', {
          email: email.toLowerCase(),
          reason: notes ?? 'Manually flagged by creator',
          confidence: 'high',
          auto_flagged: false,
          reviewed: false,
          expired: false,
        });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
      console.error('Security POST error:', e);
      return res.status(500).json({ error: 'Action failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
