export const PRODUCT_URL = 'https://charleypangus.com/products/autothresh-web';
export const PRODUCT_PRICE = '$159';

export function productUrlWithCode(code?: string): string {
  if (!code) return PRODUCT_URL;
  return `${PRODUCT_URL}?discount=${encodeURIComponent(code)}`;
}

export function formatTrialLeft(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'ended';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ${hours % 24}h left`;
  const mins = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
  if (hours < 1) return `${mins}m left`;
  return `${hours}h ${mins}m left`;
}
