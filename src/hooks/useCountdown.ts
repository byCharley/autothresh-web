import { useEffect, useState } from 'react';

/** Formats remaining time until `expiresAt` as e.g. "2d 14h 32m 08s". */
export function formatCountdown(expiresAt: string, now = Date.now()): string | null {
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  const ms = end - now;
  if (ms <= 0) return 'Ended';

  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');

  if (d > 0) return `${d}d ${h}h ${m}m ${ss}s`;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  return `${m}m ${ss}s`;
}

/** Ticks once per second while `enabled` and `expiresAt` are set. */
export function useCountdown(expiresAt?: string | null, enabled = true): string | null {
  const [label, setLabel] = useState<string | null>(() =>
    expiresAt && enabled ? formatCountdown(expiresAt) : null,
  );

  useEffect(() => {
    if (!expiresAt || !enabled) {
      setLabel(null);
      return;
    }
    setLabel(formatCountdown(expiresAt));
    const id = window.setInterval(() => setLabel(formatCountdown(expiresAt)), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, enabled]);

  return label;
}
