import { useState, useEffect, useCallback } from 'react';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce';

export interface Session {
  token:                   string;
  idToken?:                string;
  expiresAt:               string;
  email:                   string;
  firstName:               string;
  hasSubscription:         boolean;
  subscriptionStatus?:     string;
  subscriptionExpiresAt?:  string;
  planTitle?:              string;
}

const SESSION_KEY       = 'at_session';
const SHOPIFY_ID_TOKEN  = 'shopify_id_token';   // stable key, independent of session expiry
const VERIFIER_KEY      = 'at_pkce_verifier';
const STATE_KEY         = 'at_pkce_state';
const NONCE_KEY         = 'at_pkce_nonce';
const PAUSED_AT_KEY     = 'at_paused_at';
const GRACE_MS          = 30 * 60 * 1000; // 30 minutes

function recordPausedAt() {
  if (!localStorage.getItem(PAUSED_AT_KEY)) {
    localStorage.setItem(PAUSED_AT_KEY, String(Date.now()));
  }
}
function clearPausedAt() { localStorage.removeItem(PAUSED_AT_KEY); }
function withinGracePeriod(): boolean {
  const ts = localStorage.getItem(PAUSED_AT_KEY);
  return !!ts && Date.now() - parseInt(ts) < GRACE_MS;
}

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

// clearSession also removes the Shopify id_token so logout is fully clean.
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SHOPIFY_ID_TOKEN);
}

// id_token helpers — stored independently so it survives session expiry checks.
function saveIdToken(t: string) { localStorage.setItem(SHOPIFY_ID_TOKEN, t); }
function loadIdToken(): string | undefined { return localStorage.getItem(SHOPIFY_ID_TOKEN) ?? undefined; }

export type AuthStatus = 'loading' | 'unauthenticated' | 'no-subscription' | 'authenticated';

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

const DEV_SESSION: Session = {
  token: 'dev-bypass',
  expiresAt: new Date(Date.now() + 86400 * 1000 * 365).toISOString(),
  email: 'dev@localhost',
  firstName: 'Dev',
  hasSubscription: true,
};

export function useAuth() {
  const [status,  setStatus]  = useState<AuthStatus>(DEV_BYPASS ? 'authenticated' : 'loading');
  const [session, setSession] = useState<Session | null>(DEV_BYPASS ? DEV_SESSION : null);

  useEffect(() => {
    if (DEV_BYPASS) return;

    // Returning from Shopify logout (switchAccount flow) — show login screen.
    // Do NOT auto-start OAuth; user must click Sign In so Shopify presents the
    // email entry form now that the session is cleared.
    if (localStorage.getItem('at_post_logout')) {
      localStorage.removeItem('at_post_logout');
      localStorage.removeItem(VERIFIER_KEY);
      localStorage.removeItem(STATE_KEY);
      localStorage.removeItem(NONCE_KEY);
      setStatus('unauthenticated');
      return;
    }

    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const retState = params.get('state');

    if (window.location.pathname === '/auth/callback' && code) {
      // ── OAuth callback ──────────────────────────────────────────────────────
      const storedState  = sessionStorage.getItem(STATE_KEY);
      const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
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
        .then((r) => r.json() as Promise<Partial<Session> & { error?: string; idToken?: string; subscriptionStatus?: string; subscriptionExpiresAt?: string; planTitle?: string }>)
        .then((data) => {
          window.history.replaceState({}, '', '/');
          if (data.error || !data.token) { setStatus('unauthenticated'); return; }
          // Persist id_token under its own stable key for Shopify logout hint.
          if (data.idToken) saveIdToken(data.idToken);
          const isPaused = data.subscriptionStatus === 'paused' || data.subscriptionStatus === 'cancelled' || data.subscriptionStatus === 'canceled';
          if (isPaused) recordPausedAt(); else clearPausedAt();
          const s: Session = {
            token:                  data.token!,
            idToken:                data.idToken,
            expiresAt:              data.expiresAt!,
            email:                  data.email!,
            firstName:              data.firstName!,
            hasSubscription:        data.hasSubscription!,
            subscriptionStatus:     data.subscriptionStatus,
            subscriptionExpiresAt:  data.subscriptionExpiresAt,
            planTitle:              data.planTitle,
          };
          saveSession(s);
          setSession(s);
          if (!s.hasSubscription) { setStatus('no-subscription'); return; }
          if (isPaused && !withinGracePeriod()) { setStatus('no-subscription'); return; }
          setStatus('authenticated');
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
      .then((r) => r.json() as Promise<{ valid: boolean; hasSubscription: boolean; subscriptionStatus?: string; email: string; firstName: string; subscriptionExpiresAt?: string; planTitle?: string }>)
      .then((data) => {
        if (!data.valid) { clearSession(); setStatus('unauthenticated'); return; }
        // Guard: logout() clears localStorage synchronously; if it ran while
        // verify was in-flight, don't restore the session.
        if (!loadSession()) return;
        const isPaused = data.subscriptionStatus === 'paused' || data.subscriptionStatus === 'cancelled' || data.subscriptionStatus === 'canceled';
        if (isPaused) recordPausedAt(); else clearPausedAt();
        const updated: Session = { ...stored, hasSubscription: data.hasSubscription, subscriptionStatus: data.subscriptionStatus, email: data.email, firstName: data.firstName, subscriptionExpiresAt: data.subscriptionExpiresAt, planTitle: data.planTitle };
        saveSession(updated);
        setSession(updated);
        if (!data.hasSubscription) { setStatus('no-subscription'); return; }
        if (isPaused && !withinGracePeriod()) { setStatus('no-subscription'); return; }
        setStatus('authenticated');
      })
      .catch(() => {
        setSession(stored);
        setStatus(stored.hasSubscription ? 'authenticated' : 'no-subscription');
      });
  }, []);

  const initiateLogin = useCallback(async () => {
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
  }, []);

  // switchAccount: ends Shopify session then returns to this site so the user
  // can sign in with a different email. Uses the stored shopify_id_token (required
  // by Shopify's end-session endpoint) and window.location.origin so the redirect
  // URI matches exactly whichever host (www vs apex) is registered in Shopify.
  const switchAccount = useCallback(async () => {
    const idToken = loadIdToken();
    clearSession();
    clearPausedAt();
    localStorage.setItem('at_post_logout', '1');

    if (idToken) {
      const origin = window.location.origin;
      const r = await fetch(
        `/api/shopify-logout-url?id_token=${encodeURIComponent(idToken)}&origin=${encodeURIComponent(origin)}`
      );
      const { logoutUrl } = await r.json() as { logoutUrl: string };
      window.location.href = logoutUrl;
    } else {
      // No id_token stored (never logged in via OAuth, or was already cleared).
      setSession(null);
      setStatus('unauthenticated');
    }
  }, []);

  // logout: local-only — stays on AutoThresh login page.
  // Use switchAccount if you need Shopify to present a fresh email screen.
  const logout = useCallback(() => {
    clearSession();
    clearPausedAt();
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  return { status, session, initiateLogin, switchAccount, logout };
}
