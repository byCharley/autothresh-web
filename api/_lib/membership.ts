const SEAL_TOKEN   = process.env.SEAL_API_TOKEN ?? process.env.SEAL_TOKEN ?? '';
const SEAL_API_URL = 'https://app.sealsubscriptions.com/shopify/merchant/api';
const LDT_ACCESS   = process.env.LDT_ACCESS ?? '';
const LDT_API_URL  = 'https://digital.ldtsoft.work/api/integrate';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export interface SealCheck {
  hasSub: boolean;
  activeSubs: number;
  everInSeal: boolean;
  subscriptionStatus?: string;
  nextBillingDate?: string;
  planTitle?: string;
}

export interface TesterRecord {
  status: 'active' | 'paused';
  role: string;
}

export interface Membership {
  hasSubscription: boolean;
  subscriptionStatus?: string;
  planTitle?: string;
  subscriptionExpiresAt?: string;
  isTester: boolean;
  hasLifetime: boolean;
}

function blob(s: Record<string, unknown>): string {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  return [
    s.billing_interval, s.interval, s.delivery_interval,
    s.plan_title, s.product_title, s.plan_name, s.selling_plan_name,
    items[0]?.selling_plan_name, items[0]?.title, items[0]?.product_title,
  ].filter(Boolean).join(' ').toLowerCase();
}

function itemPlanName(s: Record<string, unknown>): unknown {
  const items = Array.isArray(s.items) ? s.items as Array<Record<string, unknown>> : [];
  return items[0]?.selling_plan_name ?? items[0]?.title;
}

export async function checkLdtLifetime(email: string): Promise<boolean> {
  if (!LDT_ACCESS) return false;
  try {
    const url = `${LDT_API_URL}/order/search?email=${encodeURIComponent(email)}&page=1&pageSize=20`;
    console.log('LDT request:', url);
    const r = await fetch(url, { headers: { 'LDT-X-Access-Token': LDT_ACCESS } });
    const rawText = await r.text();
    console.log('LDT HTTP status:', r.status, 'body:', rawText.slice(0, 300));
    if (!r.ok) return false;
    const raw = JSON.parse(rawText) as unknown;
    let orders: unknown[] = [];
    if (Array.isArray(raw)) {
      orders = raw;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      for (const key of ['data', 'orders', 'items', 'result', 'list']) {
        if (Array.isArray(obj[key])) { orders = obj[key] as unknown[]; break; }
      }
    }
    console.log('LDT orders found:', orders.length);

    const isLifetimeWebOrder = (o: unknown) => {
      const json = JSON.stringify(o).toLowerCase().replace(/™/g, '');
      if (!json.includes('autothresh web')) return false;
      if (json.includes('autothresh pro') || json.includes('autothresh lite')) return false;
      const looksLifetime = /\blifetime\b/.test(json);
      const looksSub = json.includes('monthly') || json.includes('annual') || json.includes('yearly');
      return looksLifetime && !looksSub;
    };

    const matched = orders.filter(isLifetimeWebOrder);
    console.log('LDT AutoThresh Web lifetime orders:', matched.length);
    return matched.length > 0;
  } catch (e) {
    console.error('LDT check error:', e);
    return false;
  }
}

export async function sealCheckSubscription(email: string): Promise<SealCheck> {
  try {
    const url = `${SEAL_API_URL}/subscriptions?query=${encodeURIComponent(email)}`;
    console.log('Seal request:', url, 'token present:', !!SEAL_TOKEN);

    const r = await fetch(url, { headers: { 'X-Seal-Token': SEAL_TOKEN } });
    const rawText = await r.text();
    console.log('Seal HTTP status:', r.status);
    console.log('Seal raw response:', rawText.slice(0, 800));

    if (!r.ok) return { hasSub: false, activeSubs: 0, everInSeal: false };

    const raw = JSON.parse(rawText) as unknown;
    let subs: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) {
      subs = raw as Array<Record<string, unknown>>;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload && Array.isArray(payload.subscriptions)) {
        subs = payload.subscriptions as Array<Record<string, unknown>>;
      } else {
        for (const key of ['subscriptions', 'data', 'result', 'subscription_contracts']) {
          if (Array.isArray(obj[key])) { subs = obj[key] as Array<Record<string, unknown>>; break; }
        }
      }
    }

    console.log('Seal parsed subs count:', subs.length);
    if (subs[0]) console.log('Seal sub[0] keys:', JSON.stringify(subs[0]));

    let nextBillingDate: string | undefined;
    let planTitle: string | undefined;
    let subscriptionStatus: string | undefined;
    let hasSub = false;
    let activeSubs = 0;
    const everInSeal = subs.length > 0;
    const TRIAL_DAYS = parseInt(process.env.SEAL_TRIAL_DAYS ?? '3', 10);

    for (const s of subs) {
      const st = String(s.status ?? '').toUpperCase();
      const text = blob(s);
      const isMonthly = text.includes('month');
      const trialEndExplicit = (s.trial_end_date ?? s.trial_ends_on ?? s.free_trial_end_date ?? s.trial_end ?? s.free_trial_end ?? s.trial_ends_at) as string | undefined;
      const isTrialType = Number(s.subscription_type) === 2 && !isMonthly;
      const orderPlaced = s.order_placed as string | undefined;
      const trialEndInferred = isTrialType && orderPlaced
        ? new Date(new Date(orderPlaced).getTime() + TRIAL_DAYS * 86_400_000).toISOString()
        : undefined;
      const trialEndRaw = trialEndExplicit ?? trialEndInferred;
      const trialStillActive = !!trialEndRaw && new Date(trialEndRaw) > new Date();
      const valid = st === 'ACTIVE' || st === 'TRIAL';
      const isInTrial = !isMonthly && (
        st === 'TRIAL'
        || (st === 'ACTIVE' && trialStillActive)
        || (isTrialType && trialStillActive)
      );

      if (valid) {
        activeSubs++;
        hasSub = true;
        if (!subscriptionStatus) {
          subscriptionStatus = isInTrial ? 'trial' : 'active';
          nextBillingDate = isInTrial
            ? (trialEndRaw ?? (s.next_billing_date as string | undefined))
            : (s.next_billing_date ?? s.next_charge_scheduled_at ?? s.next_charge_at ?? s.nextBillingDate ?? s.billing_date) as string | undefined;
          planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? itemPlanName(s)) as string | undefined;
        }
      }
    }
    if (!hasSub) {
      for (const s of subs) {
        const st = String(s.status ?? '').toUpperCase();
        if (st !== 'PAUSED') continue;
        subscriptionStatus = 'paused';
        planTitle = (s.plan_title ?? s.product_title ?? s.plan_name ?? itemPlanName(s)) as string | undefined;
        nextBillingDate = (s.next_billing_date ?? s.next_charge_scheduled_at ?? s.next_charge_at) as string | undefined;
        break;
      }
      if (!subscriptionStatus) {
        for (const s of subs) {
          const st = String(s.status ?? '').toUpperCase();
          if (st === 'CANCELLED' || st === 'CANCELED') { subscriptionStatus = 'cancelled'; break; }
        }
      }
    }
    return { hasSub, activeSubs, everInSeal, subscriptionStatus, nextBillingDate, planTitle };
  } catch (e) {
    console.error('Seal check error:', e);
    return { hasSub: false, activeSubs: 0, everInSeal: false };
  }
}

export async function checkTesterStatus(email: string): Promise<TesterRecord | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/testers?email=eq.${encodeURIComponent(email)}&select=status,role&limit=1`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );
    if (!r.ok) return null;
    const rows = await r.json() as Array<{ status: string; role?: string }>;
    if (!rows.length) return null;
    return { status: rows[0].status === 'paused' ? 'paused' : 'active', role: rows[0].role ?? 'tester' };
  } catch { return null; }
}

/**
 * Creator > live Seal plan (trial / active / paused) > tester grant > lifetime license.
 * Lifetime must never override a live subscription — LDT also records annual/monthly
 * AutoThresh Web orders, which previously made every subscriber look like lifetime.
 */
export function resolveMembership(opts: {
  isCreator: boolean;
  envTester: boolean;
  testerRecord: TesterRecord | null;
  ldtLifetime: boolean;
  seal: SealCheck;
}): Membership {
  const { isCreator, envTester, testerRecord, ldtLifetime, seal } = opts;
  const isTester = envTester || (!isCreator && testerRecord?.status === 'active' && testerRecord.role !== 'lifetime');
  const hasManualLifetime = !isCreator && testerRecord?.status === 'active' && testerRecord.role === 'lifetime';
  const liveSeal = seal.hasSub || seal.subscriptionStatus === 'paused';
  const hasLifetime = !liveSeal && (ldtLifetime || hasManualLifetime);

  if (isCreator) {
    return { hasSubscription: true, subscriptionStatus: 'creator', planTitle: 'Creator', isTester: false, hasLifetime: false };
  }
  if (liveSeal) {
    return {
      hasSubscription: seal.hasSub || seal.subscriptionStatus === 'paused',
      subscriptionStatus: seal.subscriptionStatus,
      planTitle: seal.planTitle,
      subscriptionExpiresAt: seal.nextBillingDate,
      isTester,
      hasLifetime: false,
    };
  }
  if (isTester) {
    return { hasSubscription: true, subscriptionStatus: 'tester', planTitle: 'Tester Access', isTester: true, hasLifetime: false };
  }
  if (hasLifetime) {
    return { hasSubscription: true, subscriptionStatus: 'lifetime', planTitle: 'Lifetime Access', isTester: false, hasLifetime: true };
  }
  return {
    hasSubscription: false,
    subscriptionStatus: seal.subscriptionStatus,
    planTitle: seal.planTitle,
    subscriptionExpiresAt: seal.nextBillingDate,
    isTester: false,
    hasLifetime: false,
  };
}
