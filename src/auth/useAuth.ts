import { useState, useEffect, useCallback } from 'react';

export interface Session {
  token:           string;
  expiresAt:       string;
  email:           string;
  firstName:       string;
  hasSubscription: boolean;
}

const SESSION_KEY = 'at_session';

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (new Date(s.expiresAt) < new Date()) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}

function saveSession(s: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

type AuthStatus = 'loading' | 'unauthenticated' | 'no-subscription' | 'authenticated';

export function useAuth() {
  const [status,  setStatus]  = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);

  // ── Verify stored session on mount ────────────────────────────────────────
  useEffect(() => {
    const stored = loadSession();
    if (!stored) { setStatus('unauthenticated'); return; }

    fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: stored.token }),
    })
      .then((r) => r.json() as Promise<{ valid: boolean; hasSubscription: boolean; email: string; firstName: string }>)
      .then((data) => {
        if (!data.valid) { clearSession(); setStatus('unauthenticated'); return; }
        const updated: Session = { ...stored, hasSubscription: data.hasSubscription, email: data.email, firstName: data.firstName };
        saveSession(updated);
        setSession(updated);
        setStatus(data.hasSubscription ? 'authenticated' : 'no-subscription');
      })
      .catch(() => {
        // Network error — trust cached session to avoid locking out on flaky connections
        setSession(stored);
        setStatus(stored.hasSubscription ? 'authenticated' : 'no-subscription');
      });
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json() as Partial<Session> & { error?: string };
    if (!r.ok || data.error) return data.error ?? 'Login failed';

    const s: Session = {
      token:           data.token!,
      expiresAt:       data.expiresAt!,
      email:           data.email!,
      firstName:       data.firstName!,
      hasSubscription: data.hasSubscription!,
    };
    saveSession(s);
    setSession(s);
    setStatus(s.hasSubscription ? 'authenticated' : 'no-subscription');
    return null;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  return { status, session, login, logout };
}
