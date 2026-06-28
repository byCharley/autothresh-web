const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';
const BETA_KEY = 'at_beta_vector';

// Call once at app startup. Visiting /?beta=vector sets the persistent flag.
export function initBetaFeatures() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('beta') === 'vector') {
    localStorage.setItem(BETA_KEY, '1');
    const url = new URL(window.location.href);
    url.searchParams.delete('beta');
    window.history.replaceState({}, '', url.toString());
  }
}

export function isVectorUnlocked(): boolean {
  return DEV_BYPASS || localStorage.getItem(BETA_KEY) === '1';
}
