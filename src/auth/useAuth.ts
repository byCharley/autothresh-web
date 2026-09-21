import { useState, useEffect, useCallback } from 'react';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce';
import { applyAccentByHex } from '../lib/accent';
import { deviceNameFromUa, getDeviceId } from '../lib/deviceId';
import { getBrowserFingerprint } from '../lib/fingerprint';

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
  accentColor?:            string;
  devices?:                Array<{ id: string; device_id: string; device_name: string; last_seen_at: string; created_at: string; isCurrent?: boolean }>;
}

const SESSION_KEY           = 'at_session';
const DISPLAY_NAME_KEY      = 'at_display_name';
const SHOPIFY_ID_TOKEN      = 'shopify_id_token';      // saved at login, used as logout hint
const SHOPIFY_REFRESH_TOKEN = 'shopify_refresh_token'; // used to get a fresh id_token for logout
const SHOPIFY_STORE_ID     = '52142571674';
const VERIFIER_KEY     = 'at_pkce_verifier';
const STATE_KEY        = 'at_pkce_state';
const NONCE_KEY        = 'at_pkce_nonce';
function isInactiveStatus(status?: string): boolean {
  return status === 'paused' || status === 'cancelled' || status === 'canceled' || status === 'device_limit';
}

function applyDisplayNameOverride(s: Session): Session {
  const override = localStorage.getItem(DISPLAY_NAME_KEY);
  return override ? { ...s, firstName: override } : s;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (new Date(s.expiresAt) < new Date()) { localStorage.removeItem(SESSION_KEY); return null; }
    return applyDisplayNameOverride(s);
  } catch { return null; }
}

function saveSession(s: Session) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
// clearSession removes the app session only. id_token + refresh_token are kept
// intentionally so switchAccount still works after a regular logout — they're
// overwritten at the next successful login.
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function saveIdToken(t: string)     { localStorage.setItem(SHOPIFY_ID_TOKEN, t); }
function saveRefreshToken(t: string) { localStorage.setItem(SHOPIFY_REFRESH_TOKEN, t); }
function clearShopifyTokens() {
  localStorage.removeItem(SHOPIFY_ID_TOKEN);
  localStorage.removeItem(SHOPIFY_REFRESH_TOKEN);
}

/** Decode JWT payload without verifying signature (client-side expiry check only). */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as { exp?: number };
  } catch {
    return null;
  }
}

/** Shopify logout rejects expired/malformed id_token_hint with "Invalid id_token". */
function isUsableIdToken(token: string | null | undefined): token is string {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 > Date.now() + 30_000;
}

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

export type AuthStatus = 'loading' | 'unauthenticated' | 'no-subscription' | 'authenticated' | 'trial' | 'trial-ended';

function wantsLoginScreen(): boolean {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/login' || new URLSearchParams(window.location.search).has('login');
}

function trialSession(expiresAt: string): Session {
  return {
    token: '',
    expiresAt,
    email: '',
    firstName: '',
    hasSubscription: false,
    subscriptionStatus: 'app_trial',
    subscriptionExpiresAt: expiresAt,
  };
}

type TrialClaim = { kind: 'login' } | { kind: 'unavailable' } | { kind: 'active'; expiresAt: string } | { kind: 'ended' };

async function claimAnonymousTrial(): Promise<TrialClaim> {
  if (wantsLoginScreen()) return { kind: 'login' };
  try {
    const fingerprint = await getBrowserFingerprint();
    const r = await fetch('/api/trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ deviceId: getDeviceId(), fingerprint }),
    });
    if (!r.ok) return { kind: 'unavailable' };
    const data = await r.json() as { status?: string; expiresAt?: string };
    if (data.status === 'active' && data.expiresAt) return { kind: 'active', expiresAt: data.expiresAt };
    return { kind: 'ended' };
  } catch {
    return { kind: 'unavailable' };
  }
}

function applyTrialClaim(
  claim: TrialClaim,
  setSession: (s: Session | null) => void,
  setStatus: (s: AuthStatus) => void,
) {
  if (claim.kind === 'active') {
    setSession(trialSession(claim.expiresAt));
    setStatus('trial');
    return;
  }
  if (claim.kind === 'ended') {
    setSession(null);
    setStatus('trial-ended');
    return;
  }
  setSession(null);
  setStatus('unauthenticated');
}

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'
  && !new URLSearchParams(window.location.search).has('login');

const DEV_SESSION: Session = {
  token: 'dev-bypass',
  expiresAt: new Date(Date.now() + 86400 * 1000 * 365).toISOString(),
  email: 'dev@localhost',
  firstName: 'Dev',
  hasSubscription: true,
  subscriptionStatus: 'creator',
};

export function useAuth() {
  const [status,  setStatus]  = useState<AuthStatus>(DEV_BYPASS ? 'authenticated' : 'loading');
  const [session, setSession] = useState<Session | null>(DEV_BYPASS ? DEV_SESSION : loadSession());

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
      claimAnonymousTrial().then(claim => applyTrialClaim(claim, setSession, setStatus));
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
        claimAnonymousTrial().then(claim => applyTrialClaim(claim, setSession, setStatus));
        return;
      }

      fetch('/api/auth-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier, deviceId: getDeviceId(), deviceName: deviceNameFromUa() }),
      })
        .then((r) => r.json() as Promise<Partial<Session> & { error?: string; idToken?: string; refreshToken?: string; subscriptionStatus?: string; subscriptionExpiresAt?: string; planTitle?: string }>)
        .then((data) => {
          window.history.replaceState({}, '', '/');
          if (data.error || !data.token) {
            claimAnonymousTrial().then(claim => applyTrialClaim(claim, setSession, setStatus));
            return;
          }
          if (data.idToken) saveIdToken(data.idToken);
          if (data.refreshToken) saveRefreshToken(data.refreshToken);
          const s: Session = applyDisplayNameOverride({
            token:                  data.token!,
            idToken:                data.idToken,
            expiresAt:              data.expiresAt!,
            email:                  data.email!,
            firstName:              data.firstName!,
            hasSubscription:        data.hasSubscription!,
            subscriptionStatus:     data.subscriptionStatus,
            subscriptionExpiresAt:  data.subscriptionExpiresAt,
            planTitle:              data.planTitle,
            devices:                (data as { devices?: Session['devices'] }).devices,
          });
          saveSession(s);
          setSession(s);
          // No active subscription (never subscribed, paused, or cancelled) →
          // show SubscribePage so they can sign up / resubscribe
          if (!s.hasSubscription || isInactiveStatus(s.subscriptionStatus)) {
            setStatus('no-subscription');
            return;
          }
          setStatus('authenticated');
        })
        .catch(() => {
          window.history.replaceState({}, '', '/');
          claimAnonymousTrial().then(claim => applyTrialClaim(claim, setSession, setStatus));
        });

      return;
    }

    // ── Verify stored session ─────────────────────────────────────────────
    const stored = loadSession();
    if (!stored || stored.subscriptionStatus === 'app_trial' || !stored.token) {
      claimAnonymousTrial().then(claim => applyTrialClaim(claim, setSession, setStatus));
      return;
    }

    fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: stored.token, deviceId: getDeviceId(), deviceName: deviceNameFromUa() }),
    })
      .then((r) => r.json() as Promise<{ valid: boolean; hasSubscription: boolean; subscriptionStatus?: string; email: string; firstName: string; subscriptionExpiresAt?: string; planTitle?: string; accentColor?: string }>)
      .then((data) => {
        if (!data.valid) {
          clearSession();
          claimAnonymousTrial().then(claim => applyTrialClaim(claim, setSession, setStatus));
          return;
        }
        // Guard: if logout() ran while verify was in-flight, don't restore.
        if (!loadSession()) return;
        if (data.accentColor) applyAccentByHex(data.accentColor);
        const updated: Session = applyDisplayNameOverride({ ...stored, hasSubscription: data.hasSubscription, subscriptionStatus: data.subscriptionStatus, email: data.email, firstName: data.firstName, subscriptionExpiresAt: data.subscriptionExpiresAt, planTitle: data.planTitle, accentColor: data.accentColor, devices: (data as { devices?: Session['devices'] }).devices });
        saveSession(updated);
        setSession(updated);
        if (!data.hasSubscription || isInactiveStatus(data.subscriptionStatus)) {
          setStatus('no-subscription');
          return;
        }
        setStatus('authenticated');
      })
      .catch(() => {
        // Network error during verify — keep the stored session as-is
        setSession(stored);
        setStatus(stored.hasSubscription ? 'authenticated' : 'no-subscription');
      });
  }, []);

  useEffect(() => {
    if (status !== 'trial') return;
    const tick = () => {
      claimAnonymousTrial().then(claim => {
        if (claim.kind === 'active') {
          setSession(trialSession(claim.expiresAt));
          setStatus('trial');
          return;
        }
        applyTrialClaim(claim, setSession, setStatus);
      });
    };
    const id = window.setInterval(tick, 5 * 60 * 1000);
    const vis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'trial' || !session?.subscriptionExpiresAt) return;
    const ms = Date.parse(session.subscriptionExpiresAt) - Date.now();
    if (ms <= 0) {
      setSession(null);
      setStatus('trial-ended');
      return;
    }
    const t = window.setTimeout(() => {
      setSession(null);
      setStatus('trial-ended');
    }, ms + 250);
    return () => window.clearTimeout(t);
  }, [status, session?.subscriptionExpiresAt]);

  const initiateLogin = useCallback(() => {
    // Drop expired logout hints so "Use a different account" can't keep sending
    // Shopify an Invalid id_token. Soft Sign in still uses SSO when Shopify has a session.
    const stored = localStorage.getItem(SHOPIFY_ID_TOKEN);
    if (stored && !isUsableIdToken(stored) && !localStorage.getItem(SHOPIFY_REFRESH_TOKEN)) {
      clearShopifyTokens();
    }
    return startOAuth();
  }, []);

  const recheck = useCallback(async (): Promise<boolean> => {
    const stored = loadSession();
    if (!stored) return false;
    try {
      const r = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: stored.token, deviceId: getDeviceId(), deviceName: deviceNameFromUa() }),
      });
      const data = await r.json() as { valid: boolean; hasSubscription: boolean; subscriptionStatus?: string; email: string; firstName: string; subscriptionExpiresAt?: string; planTitle?: string; accentColor?: string };
      if (!data.valid) return false;
      if (data.accentColor) applyAccentByHex(data.accentColor);
      const updated: Session = applyDisplayNameOverride({ ...stored, hasSubscription: data.hasSubscription, subscriptionStatus: data.subscriptionStatus, email: data.email, firstName: data.firstName, subscriptionExpiresAt: data.subscriptionExpiresAt, planTitle: data.planTitle, accentColor: data.accentColor });
      saveSession(updated);
      setSession(updated);
      if (!data.hasSubscription || isInactiveStatus(data.subscriptionStatus)) {
        setStatus('no-subscription');
        return false;
      }
      setStatus('authenticated');
      return true;
    } catch { return false; }
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<Session | null> => {
    const stored = loadSession();
    if (!stored) return null;
    const refreshToken = localStorage.getItem(SHOPIFY_REFRESH_TOKEN);
    if (!refreshToken) return stored;
    try {
      const r = await fetch('/api/auth-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!r.ok) return null;
      const data = await r.json() as {
        accessToken?: string;
        expiresAt?: string;
        idToken?: string;
        refreshToken?: string;
      };
      if (!data.accessToken) return null;
      if (data.idToken) saveIdToken(data.idToken);
      if (data.refreshToken) saveRefreshToken(data.refreshToken);
      const updated: Session = applyDisplayNameOverride({
        ...stored,
        token: data.accessToken,
        expiresAt: data.expiresAt ?? stored.expiresAt,
      });
      saveSession(updated);
      setSession(updated);
      return updated;
    } catch {
      return null;
    }
  }, []);

  const getValidToken = useCallback(async (): Promise<string | null> => {
    if (DEV_BYPASS) return DEV_SESSION.token;
    const stored = loadSession();
    if (!stored) return null;
    const expiresMs = new Date(stored.expiresAt).getTime();
    if (Date.now() < expiresMs - 60_000) return stored.token;
    const refreshed = await refreshAccessToken();
    return refreshed?.token ?? null;
  }, [refreshAccessToken]);

  // Always available: clear local session and force Shopify's login screen
  // (email / Google / Shop). Do NOT hit Shopify logout with a stale id_token —
  // that is what showed "Invalid id_token". prompt=login is enough to get the picker.
  const switchAccount = useCallback(async () => {
    clearSession();
    clearShopifyTokens();
    await startOAuth('login');
  }, []);

  // logout: local-only sign-out. Keeps shopify_id_token + shopify_refresh_token
  // so that switchAccount still works after the user signs out.
  const logout = useCallback(() => {
    clearSession();
    localStorage.removeItem('at-mode');
    localStorage.removeItem('at-accent');
    claimAnonymousTrial().then(claim => applyTrialClaim(claim, setSession, setStatus));
  }, []);

  const showLogin = useCallback(() => {
    window.history.replaceState({}, '', '/login');
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  const startTrial = useCallback(async (): Promise<boolean> => {
    window.history.replaceState({}, '', '/');
    const claim = await claimAnonymousTrial();
    applyTrialClaim(claim, setSession, setStatus);
    return claim.kind === 'active' || claim.kind === 'ended';
  }, []);

  const updateDisplayName = useCallback((name: string) => {
    if (name.trim()) {
      localStorage.setItem(DISPLAY_NAME_KEY, name.trim());
    } else {
      localStorage.removeItem(DISPLAY_NAME_KEY);
    }
    setSession(prev => prev ? { ...prev, firstName: name.trim() || prev.firstName } : prev);
  }, []);

  const syncSubscription = useCallback(async () => {
    const stored = loadSession();
    if (!stored) return;
    try {
      const r = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: stored.token, deviceId: getDeviceId(), deviceName: deviceNameFromUa() }),
      });
      const data = await r.json() as { valid: boolean; hasSubscription: boolean; subscriptionStatus?: string; email: string; firstName: string; subscriptionExpiresAt?: string; planTitle?: string; accentColor?: string };
      if (!data.valid) return;
      const updated: Session = applyDisplayNameOverride({ ...stored, hasSubscription: data.hasSubscription, subscriptionStatus: data.subscriptionStatus, email: data.email, firstName: data.firstName, subscriptionExpiresAt: data.subscriptionExpiresAt, planTitle: data.planTitle, accentColor: data.accentColor });
      saveSession(updated);
      setSession(updated);
      if (!data.hasSubscription || isInactiveStatus(data.subscriptionStatus)) {
        setStatus('no-subscription');
      } else {
        setStatus('authenticated');
      }
    } catch { /* keep current session */ }
  }, []);

  const activateLicense = useCallback(async (licenseKey: string, orderNumber: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'activate',
          licenseKey,
          orderNumber,
          deviceId: getDeviceId(),
          deviceName: deviceNameFromUa(),
        }),
      });
      const data = await r.json() as Partial<Session> & { ok?: boolean; error?: string; devices?: Session['devices'] };
      if (!data.token) return { ok: false, error: data.error || 'Could not activate that license.' };
      const s: Session = applyDisplayNameOverride({
        token: data.token,
        expiresAt: data.expiresAt || new Date(Date.now() + 30 * 86_400_000).toISOString(),
        email: data.email || '',
        firstName: data.firstName || '',
        hasSubscription: !!data.hasSubscription,
        subscriptionStatus: data.subscriptionStatus,
        planTitle: data.planTitle,
        devices: data.devices,
      });
      saveSession(s);
      setSession(s);
      if (!s.hasSubscription || isInactiveStatus(s.subscriptionStatus)) {
        setStatus('no-subscription');
        return { ok: false, error: data.error };
      }
      setStatus('authenticated');
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not reach the license server. Try again.' };
    }
  }, []);

  return { status, session, initiateLogin, switchAccount, logout, showLogin, startTrial, recheck, updateDisplayName, syncSubscription, getValidToken, refreshAccessToken, activateLicense };
}
