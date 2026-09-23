/**
 * Binds a verified AutoThresh Web license key to a Shopify account email
 * so Sign in (email) grants lifetime without re-entering the key.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export type LicenseBinding = {
  email: string;
  license_key: string;
  order_number: string | null;
  bound_at: string;
};

async function sb(path: string, method = 'GET', body?: unknown, prefer?: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Prefer: prefer ?? (method === 'POST' ? 'return=representation' : ''),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function licenseBindingsConfigured(): boolean {
  return !!(SUPABASE_URL && SERVICE_KEY);
}

export async function getLicenseBindingByEmail(email: string): Promise<LicenseBinding | null> {
  const e = email.trim().toLowerCase();
  if (!e || !licenseBindingsConfigured()) return null;
  const r = await sb(
    `license_bindings?email=eq.${encodeURIComponent(e)}&select=email,license_key,order_number,bound_at&limit=1`,
  );
  if (!r.ok) {
    if (r.status !== 404) console.error('[license_bindings] by email', r.status, await r.text());
    return null;
  }
  const rows = await r.json() as LicenseBinding[];
  return rows[0] ?? null;
}

export async function getLicenseBindingByKey(licenseKey: string): Promise<LicenseBinding | null> {
  const key = licenseKey.trim();
  if (!key || !licenseBindingsConfigured()) return null;
  const r = await sb(
    `license_bindings?license_key=eq.${encodeURIComponent(key)}&select=email,license_key,order_number,bound_at&limit=1`,
  );
  if (!r.ok) {
    if (r.status !== 404) console.error('[license_bindings] by key', r.status, await r.text());
    return null;
  }
  const rows = await r.json() as LicenseBinding[];
  return rows[0] ?? null;
}

/** True when this email has activated a lifetime license key. */
export async function emailHasBoundLicense(email: string): Promise<boolean> {
  return !!(await getLicenseBindingByEmail(email));
}

/**
 * Link a verified license key to an account email.
 * - One key → one email
 * - One email → one key (replacing is allowed when the new key was just verified)
 */
export async function bindLicenseToEmail(opts: {
  email: string;
  licenseKey: string;
  orderNumber?: string;
}): Promise<{ ok: true; binding: LicenseBinding } | { ok: false; error: string }> {
  if (!licenseBindingsConfigured()) {
    return { ok: false, error: 'License binding is not configured.' };
  }
  const email = opts.email.trim().toLowerCase();
  const licenseKey = opts.licenseKey.trim();
  const orderNumber = (opts.orderNumber ?? '').trim() || null;
  if (!email || !email.includes('@') || email.endsWith('@autothresh.local')) {
    return { ok: false, error: 'Sign in with your Charley Pangus email, then activate your license to link it.' };
  }
  if (!licenseKey) return { ok: false, error: 'License key is required.' };

  const byKey = await getLicenseBindingByKey(licenseKey);
  if (byKey && byKey.email !== email) {
    return {
      ok: false,
      error: 'This license is already linked to another account. Sign in with that email, or contact support.',
    };
  }

  const byEmail = await getLicenseBindingByEmail(email);
  if (byEmail && byEmail.license_key === licenseKey) {
    // Already bound — refresh order number if needed
    if (orderNumber && orderNumber !== byEmail.order_number) {
      await sb(
        `license_bindings?email=eq.${encodeURIComponent(email)}`,
        'PATCH',
        { order_number: orderNumber },
        'return=minimal',
      );
    }
    return { ok: true, binding: { ...byEmail, order_number: orderNumber ?? byEmail.order_number } };
  }

  if (byEmail && byEmail.license_key !== licenseKey) {
    // Same account activating a newly purchased / replacement key
    const updated = await sb(
      `license_bindings?email=eq.${encodeURIComponent(email)}`,
      'PATCH',
      { license_key: licenseKey, order_number: orderNumber, bound_at: new Date().toISOString() },
      'return=representation',
    );
    if (!updated.ok) {
      console.error('[license_bindings] update failed', updated.status, await updated.text());
      return { ok: false, error: 'Could not update your license link. Try again.' };
    }
    const rows = await updated.json() as LicenseBinding[];
    return { ok: true, binding: rows[0] ?? { email, license_key: licenseKey, order_number: orderNumber, bound_at: new Date().toISOString() } };
  }

  const inserted = await sb(
    'license_bindings',
    'POST',
    { email, license_key: licenseKey, order_number: orderNumber },
    'return=representation',
  );
  if (!inserted.ok) {
    const text = await inserted.text();
    console.error('[license_bindings] insert failed', inserted.status, text);
    if (text.toLowerCase().includes('does not exist') || inserted.status === 404) {
      return {
        ok: false,
        error:
          'license_bindings table missing — run supabase/license_bindings.sql in Supabase.',
      };
    }
    return { ok: false, error: 'Could not link this license to your email. Try again.' };
  }
  const rows = await inserted.json() as LicenseBinding[];
  return {
    ok: true,
    binding: rows[0] ?? {
      email,
      license_key: licenseKey,
      order_number: orderNumber,
      bound_at: new Date().toISOString(),
    },
  };
}
