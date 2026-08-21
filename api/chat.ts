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
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function identify(token: string): Promise<{ email: string; name: string; isCreator: boolean } | null> {
  if (!token) return null;
  try {
    const r = await fetch(CUST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': token },
      body: JSON.stringify({ query: `query { customer { firstName emailAddress { emailAddress } } }` }),
    });
    const body = await r.json() as { data?: { customer?: { firstName?: string; emailAddress?: { emailAddress: string } } } };
    const cust = body.data?.customer;
    if (!cust) return null;
    const email = (cust.emailAddress?.emailAddress ?? '').toLowerCase();
    return { email, name: cust.firstName ?? '', isCreator: CREATOR_EMAILS.has(email) };
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Creator status is public — no auth needed
  if (req.method === 'GET' && req.query.resource === 'status') {
    type Presence = 'online' | 'offline' | 'vacation';
    let saved: Presence | null = null;
    try {
      const sr = await sb('app_settings?key=eq.chat_status&select=value');
      if (sr.ok) {
        const srows = await sr.json() as Array<{ value: string }>;
        const v = srows[0]?.value;
        if (v === 'online' || v === 'offline' || v === 'vacation') saved = v;
      }
    } catch { /* table/key may not exist yet */ }

    if (saved === 'vacation') {
      return res.status(200).json({ is_online: false, status: 'vacation' });
    }

    const r = await sb('creator_presence?id=eq.1&select=is_online,last_seen');
    if (!r.ok) return res.status(200).json({ is_online: false, status: saved ?? 'offline' });
    const rows = await r.json() as Array<{ is_online: boolean; last_seen: string }>;
    const row = rows[0];
    if (!row) return res.status(200).json({ is_online: false, status: saved ?? 'offline' });
    const isOnline = saved !== 'offline'
      && row.is_online
      && (Date.now() - new Date(row.last_seen).getTime() < 15 * 60_000);
    return res.status(200).json({ is_online: isOnline, status: isOnline ? 'online' : 'offline' });
  }

  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const user = await identify(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const resource = String(req.query.resource ?? '');

    if (resource === 'tickets') {
      // Creator: heartbeat + return all open/pending (or all if ?all=1)
      if (user.isCreator) {
        const isOnline = await sb('creator_presence?id=eq.1&select=is_online').then(r => r.json())
          .then((rows: Array<{ is_online: boolean }>) => rows[0]?.is_online ?? false).catch(() => false);
        if (isOnline) {
          sb('creator_presence?id=eq.1', 'PATCH', { last_seen: new Date().toISOString() }).catch(() => {});
        }
        const showAll = req.query.all === '1';
        const q = showAll
          ? 'support_tickets?order=last_message_at.desc&select=*'
          : "support_tickets?status=in.(open,pending)&order=last_message_at.desc&select=*";
        const r = await sb(q);
        if (!r.ok) return res.status(500).json({ error: 'Failed' });
        return res.status(200).json(await r.json());
      }
      // User: their tickets only
      const r = await sb(`support_tickets?user_email=eq.${encodeURIComponent(user.email)}&order=last_message_at.desc&select=*`);
      if (!r.ok) return res.status(500).json({ error: 'Failed' });
      return res.status(200).json(await r.json());
    }

    if (resource === 'typing') {
      const ticketId = String(req.query.ticket ?? '');
      if (!ticketId) return res.status(400).json({ error: 'ticket required' });
      if (!user.isCreator) {
        const tr = await sb(`support_tickets?id=eq.${ticketId}&user_email=eq.${encodeURIComponent(user.email)}&select=id`);
        if (!(await tr.json() as unknown[]).length) return res.status(403).json({ error: 'Forbidden' });
      }
      try {
        const r = await sb(`support_tickets?id=eq.${ticketId}&select=user_typing_at,creator_typing_at`);
        const rows = await r.json() as Array<{ user_typing_at: string | null; creator_typing_at: string | null }>;
        const row = rows[0];
        return res.status(200).json({ userTypingAt: row?.user_typing_at ?? null, creatorTypingAt: row?.creator_typing_at ?? null });
      } catch { return res.status(200).json({ userTypingAt: null, creatorTypingAt: null }); }
    }

    if (resource === 'messages') {
      const ticketId = String(req.query.ticket ?? '');
      if (!ticketId) return res.status(400).json({ error: 'ticket required' });

      // Verify access
      if (!user.isCreator) {
        const tr = await sb(`support_tickets?id=eq.${ticketId}&user_email=eq.${encodeURIComponent(user.email)}&select=id`);
        const rows = await tr.json() as unknown[];
        if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
      }

      const r = await sb(`support_messages?ticket_id=eq.${ticketId}&order=created_at.asc&select=*`);
      if (!r.ok) return res.status(500).json({ error: 'Failed' });
      const msgs = await r.json();

      // Mark as read
      const unreadField = user.isCreator ? 'unread_by_creator' : 'unread_by_user';
      const senderToMark = user.isCreator ? 'user' : 'creator';
      sb(`support_tickets?id=eq.${ticketId}`, 'PATCH', { [unreadField]: 0 }).catch(() => {});
      sb(`support_messages?ticket_id=eq.${ticketId}&sender=eq.${senderToMark}&read_at=is.null`, 'PATCH', { read_at: new Date().toISOString() }).catch(() => {});

      return res.status(200).json(msgs);
    }

    return res.status(400).json({ error: 'Unknown resource' });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body as Record<string, unknown>;
    const resource = String(body.resource ?? '');

    if (resource === 'ticket') {
      const { subject, message } = body as { subject?: string; message?: string };
      if (!subject?.trim() || !message?.trim()) return res.status(400).json({ error: 'subject and message required' });

      // Check for existing open ticket
      const ex = await sb(`support_tickets?user_email=eq.${encodeURIComponent(user.email)}&status=in.(open,pending)&select=id&limit=1`);
      const existing = await ex.json() as Array<{ id: string }>;
      if (existing.length) return res.status(409).json({ error: 'Already has open ticket', ticket_id: existing[0].id });

      const tr = await sb('support_tickets', 'POST', {
        user_email: user.email,
        user_name: user.name,
        subject: subject.trim(),
        status: 'open',
        unread_by_creator: 1,
        unread_by_user: 0,
      });
      if (!tr.ok) return res.status(500).json({ error: 'Failed to create ticket' });
      const tickets = await tr.json() as Array<Record<string, unknown>>;
      const ticket = tickets[0];

      await sb('support_messages', 'POST', { ticket_id: ticket.id, sender: 'user', message: message.trim() });
      return res.status(200).json(ticket);
    }

    if (resource === 'message') {
      const { ticket_id, message } = body as { ticket_id?: string; message?: string };
      if (!ticket_id || !message?.trim()) return res.status(400).json({ error: 'ticket_id and message required' });

      if (!user.isCreator) {
        const tr = await sb(`support_tickets?id=eq.${ticket_id}&user_email=eq.${encodeURIComponent(user.email)}&select=id,status`);
        const rows = await tr.json() as Array<{ status: string }>;
        if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
        if (rows[0].status === 'solved') return res.status(400).json({ error: 'Ticket is closed' });
      }

      await sb('support_messages', 'POST', { ticket_id, sender: user.isCreator ? 'creator' : 'user', message: message.trim() });

      const unreadField = user.isCreator ? 'unread_by_user' : 'unread_by_creator';
      const newStatus = user.isCreator ? 'pending' : 'open';
      await sb(`support_tickets?id=eq.${ticket_id}`, 'PATCH', {
        last_message_at: new Date().toISOString(),
        [unreadField]: 1,
        status: newStatus,
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown resource' });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = req.body as Record<string, unknown>;
    const resource = String(body.resource ?? '');

    if (resource === 'ticket') {
      const { id, status } = body as { id?: string; status?: string };
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      if (!['open', 'pending', 'solved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      if (!user.isCreator) return res.status(403).json({ error: 'Forbidden' });
      await sb(`support_tickets?id=eq.${id}`, 'PATCH', { status });
      return res.status(200).json({ ok: true });
    }

    if (resource === 'message') {
      const { id, message } = body as { id?: number; message?: string };
      if (!id || !message?.trim()) return res.status(400).json({ error: 'id and message required' });

      // Verify ownership: fetch message + ticket, ensure user owns it
      const mr = await sb(`support_messages?id=eq.${id}&select=id,ticket_id,sender`);
      const msgRows = await mr.json() as Array<{ ticket_id: string; sender: string }>;
      if (!msgRows.length) return res.status(404).json({ error: 'Not found' });
      const msgRow = msgRows[0];
      if (!user.isCreator) {
        if (msgRow.sender !== 'user') return res.status(403).json({ error: 'Forbidden' });
        const tr = await sb(`support_tickets?id=eq.${msgRow.ticket_id}&user_email=eq.${encodeURIComponent(user.email)}&select=id`);
        if (!(await tr.json() as unknown[]).length) return res.status(403).json({ error: 'Forbidden' });
      }

      await sb(`support_messages?id=eq.${id}`, 'PATCH', { message: message.trim() });
      return res.status(200).json({ ok: true });
    }

    if (resource === 'typing') {
      const { ticket_id } = body as { ticket_id?: string };
      if (!ticket_id) return res.status(400).json({ error: 'ticket_id required' });
      if (!user.isCreator) {
        const tr = await sb(`support_tickets?id=eq.${ticket_id}&user_email=eq.${encodeURIComponent(user.email)}&select=id`);
        if (!(await tr.json() as unknown[]).length) return res.status(403).json({ error: 'Forbidden' });
      }
      const field = user.isCreator ? 'creator_typing_at' : 'user_typing_at';
      try {
        await sb(`support_tickets?id=eq.${ticket_id}`, 'PATCH', { [field]: new Date().toISOString() });
      } catch { /* column may not exist yet — fail silently */ }
      return res.status(200).json({ ok: true });
    }

    if (resource === 'presence') {
      if (!user.isCreator) return res.status(403).json({ error: 'Forbidden' });
      const status = body.status as string | undefined;
      const isVacation = status === 'vacation';
      const isOnline = isVacation ? false : (typeof body.is_online === 'boolean' ? body.is_online : status === 'online');
      const chatStatus = isVacation ? 'vacation' : isOnline ? 'online' : 'offline';
      const update: Record<string, unknown> = { last_seen: new Date().toISOString(), is_online: isOnline };
      await sb('creator_presence?id=eq.1', 'PATCH', update);
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/app_settings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ key: 'chat_status', value: chatStatus, updated_at: new Date().toISOString() }),
        });
      } catch { /* app_settings may not exist yet */ }
      return res.status(200).json({ ok: true, status: chatStatus, is_online: isOnline });
    }

    return res.status(400).json({ error: 'Unknown resource' });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });

    // Verify ownership
    const mr = await sb(`support_messages?id=eq.${id}&select=id,ticket_id,sender`);
    const msgRows = await mr.json() as Array<{ ticket_id: string; sender: string }>;
    if (!msgRows.length) return res.status(404).json({ error: 'Not found' });
    const msgRow = msgRows[0];
    if (!user.isCreator) {
      if (msgRow.sender !== 'user') return res.status(403).json({ error: 'Forbidden' });
      const tr = await sb(`support_tickets?id=eq.${msgRow.ticket_id}&user_email=eq.${encodeURIComponent(user.email)}&select=id`);
      if (!(await tr.json() as unknown[]).length) return res.status(403).json({ error: 'Forbidden' });
    }

    await sb(`support_messages?id=eq.${id}`, 'DELETE');
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
