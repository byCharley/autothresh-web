import { useState, useEffect } from 'react';

let _cached: string | null = null;

export function useAppVersion(fallback = '1.0.2'): string {
  const [version, setVersion] = useState(_cached ?? fallback);

  useEffect(() => {
    if (_cached !== null) { setVersion(_cached); return; }
    fetch('/api/app-settings')
      .then(r => r.ok ? r.json() : {})
      .then((d: Record<string, string>) => {
        const v = d.app_version ?? fallback;
        _cached = v;
        setVersion(v);
      })
      .catch(() => {});
  }, [fallback]);

  return version;
}
