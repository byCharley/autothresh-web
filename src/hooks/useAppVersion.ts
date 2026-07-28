import { useState, useEffect } from 'react';

let _cached: string | null = null;
const _listeners = new Set<(v: string) => void>();

export function invalidateAppVersion() {
  _cached = null;
  fetch('/api/app-settings')
    .then(r => r.ok ? r.json() : {})
    .then((d: Record<string, string>) => {
      const v = d.app_version ?? '';
      _cached = v;
      _listeners.forEach(fn => fn(v));
    })
    .catch(() => {});
}

export function useAppVersion(fallback = '1.0.2'): string {
  const [version, setVersion] = useState(_cached ?? fallback);

  useEffect(() => {
    _listeners.add(setVersion);
    if (_cached !== null) {
      setVersion(_cached);
    } else {
      fetch('/api/app-settings')
        .then(r => r.ok ? r.json() : {})
        .then((d: Record<string, string>) => {
          const v = d.app_version ?? fallback;
          _cached = v;
          setVersion(v);
        })
        .catch(() => {});
    }
    return () => { _listeners.delete(setVersion); };
  }, [fallback]);

  return version;
}
