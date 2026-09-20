import { useState } from 'react';
import { AppIcon } from './AppIcon';
import { ContactModal } from './ContactModal';
import { EulaModal } from './EulaModal';
import { FaqModal } from './FaqModal';
import { PageFooter } from './PageFooter';
import { useAppVersion } from '../hooks/useAppVersion';
import { PRODUCT_URL } from '../lib/product';

interface Props {
  onLogin: () => void;
  onSwitchAccount?: () => void;
  onActivateLicense?: (licenseKey: string, orderNumber: string) => Promise<{ ok: boolean; error?: string }>;
}

export function LoginPage({ onLogin, onSwitchAccount, onActivateLicense }: Props) {
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
  const [canSwitch] = useState(() => {
    try { return !!localStorage.getItem('shopify_id_token'); } catch { return false; }
  });

  const licenseReady = !!licenseKey.trim() && !!orderNumber.trim();
  const canActivate = licenseReady && !licenseBusy;

  const handleSignIn = () => {
    setLoading(true);
    onLogin();
  };

  return (
    <div className="login-screen">
      <div className="login-visual">
        <div className="login-visual-frame">
          <img src="/login-hero.webp" alt="AutoThresh Web on tablet" />
          <div className="login-visual-brand">
            <AppIcon size={22} color="#fff" />
            <span>AutoThresh Web</span>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-screen-body">
          <div className="login-screen-col">
            <h1 className="login-headline">Sign in to AutoThresh Web</h1>
            <p className="login-lede">Use the email on your order. Beta {appVersion}</p>

            <button className="login-primary" onClick={handleSignIn} disabled={loading}>
              {loading ? 'Redirecting…' : 'Sign in'}
              {!loading && <span className="login-primary-arrow" aria-hidden="true">→</span>}
            </button>

            {onSwitchAccount && canSwitch && (
              <button className="login-text-btn" onClick={onSwitchAccount} disabled={loading}>
                Use a different account
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
            {licenseError && <div className="login-error">{licenseError}</div>}

            <div className="login-ctas">
              <a href="/" className="login-cta login-cta-try">Try 3 days free</a>
              <a
                href={PRODUCT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="login-cta login-cta-buy"
              >
                Buy license · $149
              </a>
            </div>

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
