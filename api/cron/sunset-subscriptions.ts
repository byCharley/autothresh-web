import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sunsetAllRecurringSubscriptions } from '../_lib/sealSunset';

export const config = { maxDuration: 60 };

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = String(req.headers.authorization ?? '');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Cron processes pages until done or page cap; hourly schedule catches leftovers.
    const { scanned, results } = await sunsetAllRecurringSubscriptions();
    const summary = {
      scanned,
      scheduled: results.filter(r => r.action === 'scheduled').length,
      cancelled_now: results.filter(r => r.action === 'cancelled_now').length,
      skipped: results.filter(r => r.action === 'skipped').length,
      failed: results.filter(r => r.action === 'failed').length,
    };
    console.log('[cron/sunset-subscriptions]', JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (e) {
    console.error('[cron/sunset-subscriptions] error', e);
    return res.status(500).json({ error: 'Sunset failed' });
  }
}
