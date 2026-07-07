import { useEffect, useState } from 'react';

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let currentSha: string | null = null;

    async function check() {
      try {
        const r = await fetch('/api/version');
        if (!r.ok) return;
        const { sha } = await r.json() as { sha: string };
        if (!sha || sha === 'dev') return;
        if (currentSha === null) {
          currentSha = sha;
        } else if (sha !== currentSha) {
          setUpdateAvailable(true);
        }
      } catch { /* network error — silently skip */ }
    }

    check();
    const id = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  return updateAvailable;
}
