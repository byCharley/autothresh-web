export const PRODUCT_URL = 'https://charleypangus.com/products/autothresh-web';
export const PRODUCT_PRICE = '$159';

export function productUrlWithCode(code?: string): string {
  if (!code) return PRODUCT_URL;
  return `${PRODUCT_URL}?discount=${encodeURIComponent(code)}`;
}

export function formatTrialLeft(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'ended';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  if (d >= 1) return `${d}d ${h}h ${m}m ${ss}s left`;
  if (h >= 1) return `${h}h ${m}m ${ss}s left`;
  return `${m}m ${ss}s left`;
}
