/**
 * Fire-and-forget product analytics.
 * Requires a session token (Shopify customer access token).
 */

type TrackProps = Record<string, string | number | boolean | null | undefined>;

let tokenGetter: (() => string | null | undefined) | null = null;

/** Call once from App when auth is ready so track() can attach Authorization. */
export function setTrackTokenGetter(getter: () => string | null | undefined) {
  tokenGetter = getter;
}

export function trackEvent(event: string, props?: TrackProps) {
  try {
    const token = tokenGetter?.();
    if (!token || !event) return;

    const body = JSON.stringify({
      event,
      props: props ?? {},
    });

    // Prefer sendBeacon for unload-safe delivery; fall back to fetch.
    const blob = new Blob([body], { type: 'application/json' });
    const ok = typeof navigator !== 'undefined'
      && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon(`/api/track?auth=${encodeURIComponent(token)}`, blob);

    if (!ok) {
      void fetch('/api/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* never break the app for analytics */
  }
}
