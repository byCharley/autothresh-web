import { useEffect, useState } from 'react';
import { AppIcon } from './AppIcon';
import { ContactModal } from './ContactModal';
import { EulaModal } from './EulaModal';
import { FaqModal } from './FaqModal';
import { PageFooter } from './PageFooter';
import { useAppVersion } from '../hooks/useAppVersion';
import { PRODUCT_URL, PRODUCT_PRICE } from '../lib/product';
import { getDeviceId } from '../lib/deviceId';
import { getBrowserFingerprint } from '../lib/fingerprint';

const LOGIN_HEROES = [
  { src: '/login-hero.webp', alt: 'AutoThresh Web on tablet', fit: 'tablet' },
  { src: '/login-hero-mobile.webp', alt: 'AutoThresh Web on phone', fit: 'phone' },
];

function DeviceGlyph({ kind }: { kind: 'desktop' | 'tablet' | 'mobile' }) {
  if (kind === 'desktop') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  if (kind === 'tablet') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

const DEVICE_ITEMS = [
  { kind: 'desktop' as const, label: 'Desktop' },
  { kind: 'tablet' as const, label: 'Tablet' },
  { kind: 'mobile' as const, label: 'Mobile' },
];

interface Props {
  onLogin: () => void;
  onSwitchAccount?: () => void;
  onActivateLicense?: (licenseKey: string, orderNumber: string) => Promise<{ ok: boolean; error?: string }>;
  onStartTrial?: () => Promise<boolean>;
}

export function LoginPage({ onLogin, onSwitchAccount, onActivateLicense, onStartTrial }: Props) {
  const appVersion = useAppVersion();
  const [loading, setLoading]           = useState(false);
  const [licenseBusy, setLicenseBusy]   = useState(false);
  const [licenseError, setLicenseError] = useState('');
  const [licenseKey, setLicenseKey]     = useState('');
  const [orderNumber, setOrderNumber]   = useState('');
  const [showContact, setShowContact]   = useState(false);
  const [showEula, setShowEula]         = useState(false);
  const [showFaq, setShowFaq]           = useState(false);
  const [showInfo, setShowInfo]         = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialError, setTrialError] = useState(() => {
    try {
      const msg = sessionStorage.getItem('at_trial_error') ?? '';
      if (msg) sessionStorage.removeItem('at_trial_error');
      return msg;
    } catch {
      return '';
    }
  });
  const [trialPhase, setTrialPhase] = useState<'unknown' | 'none' | 'started'>(() => {
    try { return localStorage.getItem('at_trial_started') === '1' ? 'started' : 'unknown'; } catch { return 'unknown'; }
  });

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const fingerprint = await getBrowserFingerprint();
        const r = await fetch('/api/trial?action=status', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: getDeviceId(), fingerprint }),
        });
        if (!r.ok || cancel) return;
        const data = await r.json() as { status?: string };
        const started = data.status === 'active' || data.status === 'expired';
        if (started) {
          try { localStorage.setItem('at_trial_started', '1'); } catch { /* ignore */ }
        } else {
          try { localStorage.removeItem('at_trial_started'); } catch { /* ignore */ }
        }
        if (!cancel) setTrialPhase(started ? 'started' : 'none');
      } catch {
        if (!cancel) setTrialPhase(prev => prev === 'unknown' ? 'none' : prev);
      }
    })();
    return () => { cancel = true; };
  }, []);
  const [switchBusy, setSwitchBusy] = useState(false);

  const licenseReady = !!licenseKey.trim() && !!orderNumber.trim();
  const canActivate = licenseReady && !licenseBusy;
  const anyBusy = loading || switchBusy;

  const handleSignIn = () => {
    setLoading(true);
    onLogin();
  };

  const handleSwitchAccount = async () => {
    if (!onSwitchAccount || anyBusy) return;
    setSwitchBusy(true);
    try {
      await onSwitchAccount();
    } finally {
      setSwitchBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-visual">
        <div className="login-visual-frame">
          {LOGIN_HEROES.map(img => (
            <img
              key={img.src}
              src={img.src}
              alt={img.alt}
              data-fit={img.fit}
            />
          ))}
          <div className="login-visual-brand">
            <AppIcon size={22} color="#fff" />
            <span>AutoThresh Web</span>
          </div>
          <div className="login-visual-devices" aria-label="Works on desktop, tablet, and mobile">
            {DEVICE_ITEMS.map(item => (
              <span key={item.kind}>
                <DeviceGlyph kind={item.kind} />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-screen-body">
          <div className="login-screen-col">
            <h1 className="login-headline">Sign in to AutoThresh Web</h1>
            <p className="login-lede">Use the email on your order. Beta {appVersion}</p>
            <div className="login-devices" aria-label="Works on desktop, tablet, and mobile">
              {DEVICE_ITEMS.map(item => (
                <span key={item.kind}>
                  <DeviceGlyph kind={item.kind} />
                  {item.label}
                </span>
              ))}
            </div>

            <button className="login-primary" onClick={handleSignIn} disabled={anyBusy}>
              {loading ? 'Redirecting…' : 'Sign in'}
              {!loading && <span className="login-primary-arrow" aria-hidden="true">→</span>}
            </button>

            {onSwitchAccount && (
              <button className="login-text-btn" onClick={handleSwitchAccount} disabled={anyBusy}>
                {switchBusy ? 'Opening sign-in…' : 'Use a different account'}
              </button>
            )}

            <div className="login-rule">License key</div>

            <input
              className="login-input"
              value={licenseKey}
              onChange={e => setLicenseKey(e.target.value)}
              placeholder="License key"
            />
            <input
              className="login-input"
              value={orderNumber}
              onChange={e => setOrderNumber(e.target.value)}
              placeholder="Order number"
            />
            <button
              className={`login-secondary${licenseReady ? ' is-on' : ''}`}
              onClick={async () => {
                if (!onActivateLicense || !canActivate) return;
                setLicenseBusy(true);
                setLicenseError('');
                const result = await onActivateLicense(licenseKey.trim(), orderNumber.trim());
                if (!result.ok) setLicenseError(result.error || 'Could not activate that license.');
                setLicenseBusy(false);
              }}
              disabled={!canActivate}
            >
              {licenseBusy ? 'Checking…' : 'Activate'}
            </button>
            <p className="login-trial-note" style={{ marginTop: 8 }}>
              Activating links this license to your email (up to 3 devices). After that, use Sign in with the same email.
            </p>
            {licenseError && <div className="login-error">{licenseError}</div>}

            <div className="login-ctas">
              <button
                type="button"
                className="login-cta login-cta-try"
                disabled={trialBusy || trialPhase === 'unknown'}
                onClick={async () => {
                  if (!onStartTrial || trialBusy) return;
                  setTrialBusy(true);
                  setTrialError('');
                  const ok = await onStartTrial();
                  // New trials redirect to Shopify sign-in; keep busy until navigation.
                  if (!ok) {
                    setTrialError('Could not start your trial. Try again, or sign in if you already have access.');
                    setTrialBusy(false);
                  }
                }}
              >
                {trialBusy ? 'Starting…' : trialPhase === 'started' ? 'Continue with trial' : trialPhase === 'unknown' ? 'Checking trial…' : 'Start 3 Day Trial'}
              </button>
              <a
                href={PRODUCT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="login-cta login-cta-buy"
              >
                Buy license · {PRODUCT_PRICE}
              </a>
            </div>
            <p className="login-trial-note">
              A free trial requires an account on{' '}
              <a href="https://charleypangus.com" target="_blank" rel="noopener noreferrer">charleypangus.com</a>.
              Sign in with your email — your account is created automatically.
            </p>
            {trialError && <div className="login-error">{trialError}</div>}

            <button className="login-text-btn login-about" onClick={() => setShowInfo(true)}>
              About AutoThresh Web
            </button>
          </div>
        </div>

        <div className="login-screen-footer">
          <PageFooter onEula={() => setShowEula(true)} onFaq={() => setShowFaq(true)} onContact={() => setShowContact(true)} />
        </div>
      </div>

      {showInfo && (
        <div
          className="login-modal-scrim"
          onClick={() => setShowInfo(false)}
        >
          <div className="login-modal" onClick={e => e.stopPropagation()}>
            <div className="login-modal-head">
              <div>About AutoThresh Web</div>
              <button onClick={() => setShowInfo(false)} aria-label="Close">✕</button>
            </div>
            <p>
              AutoThresh Web is the next step in the AutoThresh ecosystem. Built on the same trusted AutoThresh® Engine,
              it expands the lineup beyond Photoshop, so you can make professional color separations in the browser.
            </p>
          </div>
        </div>
      )}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
      {showEula && <EulaModal onClose={() => setShowEula(false)} />}
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}
    </div>
  );
}
