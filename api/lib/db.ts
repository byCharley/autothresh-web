// Uses Supabase PostgREST directly via fetch — no npm package needed

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function headers(extra?: Record<string, string>) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation',
    ...extra,
  };
}

export const db = {
  async getPresets(email: string): Promise<unknown[]> {
    const url = `${SUPABASE_URL}/rest/v1/presets?user_email=eq.${encodeURIComponent(email)}&order=updated_at.desc&select=id,name,data,created_at,updated_at`;
    const r = await fetch(url, { headers: headers() });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  async createPreset(email: string, name: string, data: unknown): Promise<unknown> {
    const url = `${SUPABASE_URL}/rest/v1/presets`;
    const r = await fetch(url, {
      method: 'POST',
      headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({ user_email: email, name, data }),
    });
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json() as unknown[];
    return rows[0];
  },

  async deletePreset(id: string, email: string): Promise<void> {
    const url = `${SUPABASE_URL}/rest/v1/presets?id=eq.${id}&user_email=eq.${encodeURIComponent(email)}`;
    const r = await fetch(url, { method: 'DELETE', headers: headers() });
    if (!r.ok) throw new Error(await r.text());
  },
};
