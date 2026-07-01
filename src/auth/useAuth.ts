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

const SESSION_KEY          = 'at_session';
const SHOPIFY_ID_TOKEN     = 'shopify_id_token';      // saved at login, used as logout hint
const SHOPIFY_REFRESH_TOKEN = 'shopify_refresh_token'; // used to get a fresh id_token for logout
const SHOPIFY_STORE_ID     = '52142571674';
const VERIFIER_KEY     = 'at_pkce_verifier';
const STATE_KEY        = 'at_pkce_state';
const NONCE_KEY        = 'at_pkce_nonce';
const PAUSED_AT_KEY    = 'at_paused_at';
const GRACE_MS         = 30 * 60 * 1000;

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
// clearSession removes the app session only. id_token + refresh_token are kept
// intentionally so switchAccount still works after a regular logout — they're
// overwritten at the next successful login.
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function saveIdToken(t: string)     { localStorage.setItem(SHOPIFY_ID_TOKEN, t); }
function saveRefreshToken(t: string) { localStorage.setItem(SHOPIFY_REFRESH_TOKEN, t); }

// Shared helper: generate PKCE + state, store in sessionStorage, redirect to Shopify OAuth.
async function startOAuth(prompt?: string) {
  const verifier  = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state     = generateState();
  const nonce     = generateState();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);
  const qs = new URLSearchParams({ challenge, state, nonce });
  if (prompt) qs.set('prompt', prompt);
  const r = await fetch(`/api/auth-init?${qs}`);
  const { redirectUrl } = await r.json() as { redirectUrl: string };
  window.location.href = redirectUrl;
}

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

    // /auth/start — landing page after Shopify logout; immediately starts a fresh
    // OAuth flow with prompt=login so Shopify shows the email entry screen.
    if (window.location.pathname === '/auth/start') {
      window.history.replaceState({}, '', '/');
      startOAuth('login');
      return;
    }

    // Legacy at_post_logout flag — keep as a fallback in case it was set by an
    // older session. Just clean up and show the login screen.
    if (localStorage.getItem('at_post_logout')) {
      localStorage.removeItem('at_post_logout');
      setStatus('unauthenticated');
      return;
    }

    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const retState = params.get('state');

    if (window.location.pathname === '/auth/callback' && code) {
      // ── OAuth callback ────────────────────────────────────────────────────
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
        .then((r) => r.json() as Promise<Partial<Session> & { error?: string; idToken?: string; refreshToken?: string; subscriptionStatus?: string; subscriptionExpiresAt?: string; planTitle?: string }>)
        .then((data) => {
          window.history.replaceState({}, '', '/');
          if (data.error || !data.token) { setStatus('unauthenticated'); return; }
          if (data.idToken) saveIdToken(data.idToken);
          if (data.refreshToken) saveRefreshToken(data.refreshToken);
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

    // ── Verify stored session ─────────────────────────────────────────────
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
        // Guard: if logout() ran while verify was in-flight, don't restore.
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

  const initiateLogin = useCallback(() => startOAuth(), []);

  // switchAccount: reads shopify_id_token/refresh_token (kept across regular
  // logouts), refreshes to get a non-expired hint, then hits Shopify's OIDC
  // end-session endpoint. Shopify clears its session and redirects to /auth/start
  // which fires a fresh OAuth with prompt=login so the email screen appears.
  // Requires Shopify Customer Account API → Logout URIs:
  //   https://autothresh.com/auth/start
  //   https://www.autothresh.com/auth/start  (no trailing slash)
  const switchAccount = useCallback(async () => {
    const storedIdToken      = localStorage.getItem(SHOPIFY_ID_TOKEN);
    const storedRefreshToken = localStorage.getItem(SHOPIFY_REFRESH_TOKEN);

    if (!storedIdToken && !storedRefreshToken) {
      alert('Sign out and sign back in once to enable account switching.');
      return;
    }

    // Clear the app session now (keep Shopify tokens for the logout hint).
    clearSession();
    clearPausedAt();

    let idToken = storedIdToken;

    // Refresh to get a guaranteed non-expired id_token (Shopify rejects stale hints).
    if (storedRefreshToken) {
      try {
        const r = await fetch('/api/auth-refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: storedRefreshToken }),
        });
        const data = await r.json() as { idToken?: string; refreshToken?: string };
        if (data.idToken) { idToken = data.idToken; saveIdToken(data.idToken); }
        if (data.refreshToken) saveRefreshToken(data.refreshToken);
      } catch { /* fall back to storedIdToken */ }
    }

    if (!idToken) {
      alert('Sign out and sign back in once to enable account switching.');
      return;
    }

    const logoutUrl = new URL(`https://shopify.com/authentication/${SHOPIFY_STORE_ID}/logout`);
    logoutUrl.searchParams.set('id_token_hint', idToken);
    logoutUrl.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/auth/start`);
    window.location.href = logoutUrl.toString();
  }, []);

  // logout: local-only sign-out. Keeps shopify_id_token + shopify_refresh_token
  // so that switchAccount still works after the user signs out.
  const logout = useCallback(() => {
    clearSession(); // only removes SESSION_KEY
    clearPausedAt();
    localStorage.removeItem('at-mode'); // reset so next login starts in Thresh mode
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  return { status, session, initiateLogin, switchAccount, logout };
}
