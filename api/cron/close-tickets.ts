import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET  = process.env.CRON_SECRET ?? '';

const INACTIVITY_DAYS = 3;
const CLOSE_MESSAGE =
  'This ticket was automatically closed after 3 days of inactivity. ' +
  'If you still need help, open a new conversation and we\'ll be happy to assist.';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel passes CRON_SECRET as a bearer token on cron invocations
  const auth = String(req.headers.authorization ?? '');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cutoff = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Get all open/pending tickets with no activity in the last 3 days
  const tr = await sb(
    `support_tickets?status=in.(open,pending)&last_message_at=lt.${cutoff}&select=id,user_email`
  );
  if (!tr.ok) return res.status(500).json({ error: 'Failed to fetch tickets' });
  const tickets = await tr.json() as Array<{ id: string; user_email: string }>;

  if (!tickets.length) return res.status(200).json({ closed: 0 });

  let closed = 0;

  for (const ticket of tickets) {
    // Check that the last message was from the creator (we replied, user didn't respond)
    const mr = await sb(
      `support_messages?ticket_id=eq.${ticket.id}&order=created_at.desc&limit=1&select=sender`
    );
    if (!mr.ok) continue;
    const msgs = await mr.json() as Array<{ sender: string }>;
    if (!msgs.length || msgs[0].sender !== 'creator') continue;

    // Post the closing system message
    await sb('support_messages', 'POST', {
      ticket_id: ticket.id,
      sender: 'system',
      message: CLOSE_MESSAGE,
    });

    // Close the ticket
    await sb(`support_tickets?id=eq.${ticket.id}`, 'PATCH', {
      status: 'solved',
      last_message_at: new Date().toISOString(),
    });

    closed++;
  }

  return res.status(200).json({ closed, checked: tickets.length });
}
