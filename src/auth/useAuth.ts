import { useState, useEffect, useCallback } from 'react';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce';

export interface Session {
  token:                   string;
  idToken?:                string;
  expiresAt:               string;
  email:                   string;
  firstName:               string;
  hasSubscription:         boolean;
  subscriptionExpiresAt?:  string;
}

const SESSION_KEY  = 'at_session';
const VERIFIER_KEY = 'at_pkce_verifier';
const STATE_KEY    = 'at_pkce_state';
const NONCE_KEY    = 'at_pkce_nonce';

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (new Date(s.expiresAt) < new Date()) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}

function saveSession(s: Session) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

export type AuthStatus = 'loading' | 'unauthenticated' | 'no-subscription' | 'authenticated';

export function useAuth() {
  const [status,  setStatus]  = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Returning from Shopify logout (switch account flow) — auto-start fresh login
    if (sessionStorage.getItem('at_post_logout')) {
      sessionStorage.removeItem('at_post_logout');
      (async () => {
        const verifier  = await generateCodeVerifier();
        const challenge = await generateCodeChallenge(verifier);
        const state     = generateState();
        const nonce     = generateState();
        sessionStorage.setItem(VERIFIER_KEY, verifier);
        sessionStorage.setItem(STATE_KEY, state);
        sessionStorage.setItem(NONCE_KEY, nonce);
        const r = await fetch(`/api/auth-init?challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}`);
        const { redirectUrl } = await r.json() as { redirectUrl: string };
        window.location.href = redirectUrl;
      })();
      return;
    }

    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const retState = params.get('state');

    if (window.location.pathname === '/auth/callback' && code) {
      // ── OAuth callback ──────────────────────────────────────────────────────
      const storedState    = sessionStorage.getItem(STATE_KEY);
      const codeVerifier   = sessionStorage.getItem(VERIFIER_KEY);
      sessionStorage.removeItem(STATE_KEY);
      sessionStorage.removeItem(VERIFIER_KEY);

      if (!codeVerifier || retState !== storedState) {
        window.history.replaceState({}, '', '/');
        setStatus('unauthenticated');
        return;
      }

      fetch('/api/auth-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier }),
      })
        .then((r) => r.json() as Promise<Partial<Session> & { error?: string; idToken?: string; subscriptionExpiresAt?: string }>)
        .then((data) => {
          window.history.replaceState({}, '', '/');
          if (data.error || !data.token) { setStatus('unauthenticated'); return; }
          const s: Session = {
            token:                   data.token!,
            idToken:                 data.idToken,
            expiresAt:               data.expiresAt!,
            email:                   data.email!,
            firstName:               data.firstName!,
            hasSubscription:         data.hasSubscription!,
            subscriptionExpiresAt:   data.subscriptionExpiresAt,
          };
          saveSession(s);
          setSession(s);
          setStatus(s.hasSubscription ? 'authenticated' : 'no-subscription');
        })
        .catch(() => { window.history.replaceState({}, '', '/'); setStatus('unauthenticated'); });

      return;
    }

    // ── Verify stored session ───────────────────────────────────────────────
    const stored = loadSession();
    if (!stored) { setStatus('unauthenticated'); return; }

    fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: stored.token }),
    })
      .then((r) => r.json() as Promise<{ valid: boolean; hasSubscription: boolean; email: string; firstName: string; subscriptionExpiresAt?: string }>)
      .then((data) => {
        if (!data.valid) { clearSession(); setStatus('unauthenticated'); return; }
        const updated: Session = { ...stored, hasSubscription: data.hasSubscription, email: data.email, firstName: data.firstName, subscriptionExpiresAt: data.subscriptionExpiresAt };
        saveSession(updated);
        setSession(updated);
        setStatus(data.hasSubscription ? 'authenticated' : 'no-subscription');
      })
      .catch(() => {
        // Network error — trust cached session
        setSession(stored);
        setStatus(stored.hasSubscription ? 'authenticated' : 'no-subscription');
      });
  }, []);

  const initiateLogin = useCallback(async () => {
    const verifier   = await generateCodeVerifier();
    const challenge  = await generateCodeChallenge(verifier);
    const state      = generateState();
    const nonce      = generateState();

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(NONCE_KEY, nonce);

    const r = await fetch(`/api/auth-init?challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}`);
    const { redirectUrl } = await r.json() as { redirectUrl: string; logoutUrl: string };
    window.location.href = redirectUrl;
  }, []);

  const switchAccount = useCallback(async () => {
    const currentSession = loadSession();
    clearSession();
    sessionStorage.setItem('at_post_logout', '1');
    const idTokenHint = currentSession?.idToken ?? '';
    const r = await fetch(`/api/shopify-logout-url?id_token_hint=${encodeURIComponent(idTokenHint)}`);
    const { logoutUrl } = await r.json() as { logoutUrl: string };
    window.location.href = logoutUrl;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  return { status, session, initiateLogin, switchAccount, logout };
}
