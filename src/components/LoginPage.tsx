import { useState } from 'react';
import { AppIcon } from './AppIcon';
import { ContactModal } from './ContactModal';
import { EulaModal } from './EulaModal';
import { FaqModal } from './FaqModal';
import { PageFooter } from './PageFooter';
import { useAppVersion } from '../hooks/useAppVersion';

interface Props {
  onLogin: () => void;
  onSwitchAccount?: () => void;
  onActivateLicense?: (licenseKey: string, orderNumber: string) => Promise<{ ok: boolean; error?: string }>;
}

export function LoginPage({ onLogin, onSwitchAccount, onActivateLicense }: Props) {
  const appVersion = useAppVersion();
  const [loading, setLoading]               = useState(false);
  const [licenseBusy, setLicenseBusy]       = useState(false);
  const [licenseError, setLicenseError]     = useState('');
  const [licenseKey, setLicenseKey]         = useState('');
  const [orderNumber, setOrderNumber]       = useState('');
  const [showContact, setShowContact]       = useState(false);
  const [showEula, setShowEula]             = useState(false);
  const [showFaq, setShowFaq]               = useState(false);
  const [showInfo, setShowInfo]             = useState(false);
  const [showSubscribe, setShowSubscribe]   = useState(false);

  const handleSignIn = () => {
    setLoading(true);
    onLogin();
  };

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: 'var(--bg)',
      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
      backgroundSize: '28px 28px',
      display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        flex: 1,
        width: '100%', maxWidth: 400,
        margin: '0 auto',
        padding: '32px 16px 16px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
      }}>

        {/* Logo */}
        <div style={{ marginBottom: 36, textAlign: 'center', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, marginBottom: 18 }}>
            <AppIcon size={68} color="#f1f2f2" />
            <span style={{ width: 1, height: 52, background: 'rgba(255,255,255,0.2)', display: 'block', flexShrink: 0 }} />
            <img
              src="/CharleyPangus_Favicon.svg"
              alt="Charley Pangus"
              style={{ height: 54, width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.9 }}
            />
          </div>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
            AutoThresh™ Web <span style={{ color: 'var(--accent)' }}>Beta {appVersion}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 7, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', lineHeight: 1.9 }}>
            Professional Color Separation App<br />Trusted By Pros Worldwide<br />Community Led Improvements Weekly
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          width: '100%', padding: '28px 28px 24px',
        }}>
          {/* Header */}
          <div style={{ marginBottom: 22, textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '-0.01em', marginBottom: 7 }}>
              Sign In to AutoThresh™ Web
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.65 }}>
              Sign in with the email you bought with, or activate with your license key and order number.
            </div>
          </div>

          {/* Sign In button */}
          <button
            onClick={handleSignIn}
            disabled={loading}
            style={{
              width: '100%', padding: '12px 20px',
              background: loading ? 'var(--surface-2)' : 'var(--accent)',
              border: '1px solid transparent',
              cursor: loading ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
              color: loading ? 'var(--text-muted)' : '#000',
              fontFamily: 'var(--font-mono)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >
            {loading ? (
              <span style={{ opacity: 0.5 }}>Redirecting…</span>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                  <polyline points="10 17 15 12 10 7"/>
                  <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                Sign In
              </>
            )}
          </button>

          {/* Switch account */}
          {onSwitchAccount && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <button
                onClick={onSwitchAccount}
                disabled={loading}
                style={{
                  width: '100%', padding: '9px 20px',
                  background: 'none', border: '1px solid var(--border)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.7')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <polyline points="16 11 18 13 22 9"/>
                </svg>
                Sign in with a different account
              </button>
            </div>
          )}

          {/* License key */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10, textAlign: 'center' }}>
              Or activate with your license
            </div>
            <input
              value={licenseKey}
              onChange={e => setLicenseKey(e.target.value)}
              placeholder="License key"
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 8,
                padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12,
              }}
            />
            <input
              value={orderNumber}
              onChange={e => setOrderNumber(e.target.value)}
              placeholder="Order number"
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 10,
                padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12,
              }}
            />
            <button
              onClick={async () => {
                if (!onActivateLicense || licenseBusy) return;
                setLicenseBusy(true);
                setLicenseError('');
                const result = await onActivateLicense(licenseKey.trim(), orderNumber.trim());
                if (!result.ok) setLicenseError(result.error || 'Could not activate that license.');
                setLicenseBusy(false);
              }}
              disabled={licenseBusy || !licenseKey.trim() || !orderNumber.trim()}
              style={{
                width: '100%', padding: '10px 16px',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                cursor: licenseBusy ? 'default' : 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: 'var(--text)',
              }}
            >
              {licenseBusy ? 'Checking license…' : 'Activate license'}
            </button>
            {licenseError && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#f87171', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                {licenseError}
              </div>
            )}
          </div>

          {/* Buy lifetime */}
          <div style={{
            marginTop: 18, paddingTop: 16,
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              Need a license?
            </span>
            <button
              onClick={() => setShowSubscribe(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                fontWeight: 700, padding: 0,
              }}
            >
              Buy lifetime — $149
            </button>
          </div>
        </div>

        {/* About link */}
        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <button
            onClick={() => setShowInfo(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
              opacity: 0.65, transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.65')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            About AutoThresh™ Web
          </button>
        </div>

        {/* About modal */}
        {showInfo && (
          <div
            onClick={() => setShowInfo(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 100,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '24px 20px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                width: '100%', maxWidth: 420,
                padding: '20px 20px 24px',
                position: 'relative',
                maxHeight: '80dvh', overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                  About AutoThresh™ Web
                </div>
                <button
                  onClick={() => setShowInfo(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, display: 'flex', lineHeight: 0 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                Part of the Growing AutoThresh™ Lineup
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.75, margin: '0 0 12px', fontFamily: 'var(--font-sans)' }}>
                AutoThresh™ Web is the next step in the AutoThresh ecosystem. Built on the same trusted AutoThresh® Engine,
                it expands the lineup beyond Photoshop, giving you the freedom to create professional color separations directly in your browser.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.75, margin: 0, fontFamily: 'var(--font-sans)' }}>
                Whether you prefer the speed of the Photoshop plugin or the flexibility of a web app, every AutoThresh product
                is designed to deliver the same high-quality results while continuing to add new tools, workflows, and separation technologies.
              </p>
            </div>
          </div>
        )}

        {/* Subscribe modal */}
        {showSubscribe && (
          <div
            onClick={() => setShowSubscribe(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 100,
              background: 'rgba(0,0,0,0.82)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '24px 16px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                width: '100%', maxWidth: 460,
                padding: '28px 28px 30px',
                position: 'relative',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>
                  AutoThresh™ Web
                </div>
                <button
                  onClick={() => setShowSubscribe(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, display: 'flex', lineHeight: 0 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em', marginBottom: 8 }}>
                Lifetime Access
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.55, marginBottom: 24 }}>
                Pay once. Own it forever. Two devices per license.
              </div>
              <div style={{ padding: '22px 20px', border: '1px solid #fbbf24', background: 'rgba(251,191,36,0.04)', marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: '#fbbf24', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>One-time</div>
                <div style={{ fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 34, fontWeight: 700 }}>$149</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>once</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  All separation modes, exports, presets, and future updates. No subscription.
                </div>
              </div>
              <a
                href="https://charleypangus.com/checkout/autothresh-web/lifetime"
                target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', width: '100%', boxSizing: 'border-box',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '14px 20px', border: '1px solid #fbbf24',
                  background: '#fbbf24', color: '#000', textDecoration: 'none',
                  fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                }}
              >
                Buy Lifetime Access
              </a>
              <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textAlign: 'center', lineHeight: 1.5 }}>
                After checkout, sign in with your Charley Pangus email or enter your license key and order number.
              </div>
            </div>
          </div>
        )}

      </div>{/* end centering wrapper */}

      <PageFooter onEula={() => setShowEula(true)} onFaq={() => setShowFaq(true)} onContact={() => setShowContact(true)} />
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
      {showEula && <EulaModal onClose={() => setShowEula(false)} />}
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}

    </div>
  );
}
