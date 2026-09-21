import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sunsetAllRecurringSubscriptions } from '../_lib/sealSunset';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = String(req.headers.authorization ?? '');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { scanned, results } = await sunsetAllRecurringSubscriptions();
    const summary = {
      scanned,
      scheduled: results.filter(r => r.action === 'scheduled').length,
      cancelled_now: results.filter(r => r.action === 'cancelled_now').length,
      skipped: results.filter(r => r.action === 'skipped').length,
      failed: results.filter(r => r.action === 'failed').length,
      results,
    };
    console.log('[cron/sunset-subscriptions]', JSON.stringify({
      scanned: summary.scanned,
      scheduled: summary.scheduled,
      cancelled_now: summary.cancelled_now,
      skipped: summary.skipped,
      failed: summary.failed,
    }));
    return res.status(200).json(summary);
  } catch (e) {
    console.error('[cron/sunset-subscriptions] error', e);
    return res.status(500).json({ error: 'Sunset failed' });
  }
}
