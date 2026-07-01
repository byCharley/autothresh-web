import { useState } from 'react';
import { AppIcon } from './AppIcon';
import { EulaModal } from './EulaModal';
import { FaqModal } from './FaqModal';
import { PageFooter } from './PageFooter';

interface Props {
  onLogin: () => void;
  onSwitchAccount?: () => void;
}

export function LoginPage({ onLogin, onSwitchAccount }: Props) {
  const [loading, setLoading]               = useState(false);
  const [showEula, setShowEula]             = useState(false);
  const [showFaq, setShowFaq]               = useState(false);
  const [showInfo, setShowInfo]             = useState(false);
  const [showSubscribe, setShowSubscribe]   = useState(false);
  const [selectedPlan, setSelectedPlan]     = useState<'monthly' | 'yearly'>('yearly');

  const handleSignIn = () => {
    setLoading(true);
    onLogin();
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
      backgroundSize: '28px 28px',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center',
      padding: '32px 16px',
      paddingBottom: 'max(32px, calc(env(safe-area-inset-bottom, 0px) + 24px))',
      boxSizing: 'border-box',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        margin: 'auto',
        width: '100%', maxWidth: 400,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
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
            AutoThresh™ Web <span style={{ color: 'var(--accent)' }}>Beta 1.0.1</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 7, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', lineHeight: 1.9 }}>
            Professional Color Separation<br />Trusted By Pros Worldwide
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
              Use your{' '}
              <a
                href="https://www.charleypangus.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text)', fontWeight: 600, textDecoration: 'none' }}
              >
                Charley Pangus
              </a>
              {' '}account email — you'll receive a one-time sign-in code.
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

          {/* Subscribe row */}
          <div style={{
            marginTop: 18, paddingTop: 16,
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              No subscription yet?
            </span>
            <button
              onClick={() => setShowSubscribe(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                fontWeight: 700, padding: 0, transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
              Subscribe
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
                Choose a Plan
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.55, marginBottom: 24 }}>
                Unlimited separations. Start free for 3 days — no charge until your trial ends.
              </div>

              {/* Side-by-side plan cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>

                {/* Monthly */}
                <div
                  onClick={(e) => { e.stopPropagation(); setSelectedPlan('monthly'); }}
                  style={{
                    padding: '20px 18px 18px',
                    border: `2px solid ${selectedPlan === 'monthly' ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectedPlan === 'monthly' ? 'rgba(255,165,0,0.06)' : 'var(--surface-2)',
                    cursor: 'pointer', position: 'relative',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  {selectedPlan === 'monthly' && (
                    <div style={{ position: 'absolute', top: 10, right: 10, color: 'var(--accent)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Monthly</div>
                  <div style={{ fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                    <span style={{ fontSize: 30, fontWeight: 700 }}>$11.99</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>/month</div>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>
                    3-day free trial<br />Cancel anytime
                  </div>
                  <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', opacity: 0.6, lineHeight: 1.5 }}>
                    $11.99 charged after trial
                  </div>
                </div>

                {/* Annual */}
                <div
                  onClick={(e) => { e.stopPropagation(); setSelectedPlan('yearly'); }}
                  style={{
                    padding: '20px 18px 18px',
                    border: `2px solid ${selectedPlan === 'yearly' ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectedPlan === 'yearly' ? 'rgba(255,165,0,0.06)' : 'var(--surface-2)',
                    cursor: 'pointer', position: 'relative',
                    transition: 'border-color 0.15s, background 0.15s',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 0, right: 0,
                    background: 'var(--accent)', color: '#000',
                    fontSize: 8, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    padding: '4px 9px', letterSpacing: '0.08em',
                  }}>SAVE 20%</div>
                  {selectedPlan === 'yearly' && (
                    <div style={{ position: 'absolute', bottom: 14, right: 14, color: 'var(--accent)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Annual</div>
                  <div style={{ fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                    <span style={{ fontSize: 30, fontWeight: 700 }}>$9.59</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>/month</div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2, opacity: 0.7 }}>$115.10 billed yearly</div>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>
                    3-day free trial<br />Best value
                  </div>
                  <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', opacity: 0.6, lineHeight: 1.5 }}>
                    $115.10 charged after trial
                  </div>
                </div>

              </div>

              {/* CTA */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const url = selectedPlan === 'monthly'
                    ? 'https://charleypangus.myshopify.com/cart/48356328210586:1?selling_plan=305671962778'
                    : 'https://charleypangus.com/checkout/autothresh-web/yearly';
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                style={{
                  display: 'flex', width: '100%', boxSizing: 'border-box',
                  alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '14px 20px', border: 'none',
                  background: 'var(--accent)', color: '#000',
                  fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em', cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
              >
                Try It Free — 3 Days
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </button>

              <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textAlign: 'center', lineHeight: 1.5, opacity: 0.7 }}>
                No charge until your trial ends. Cancel anytime.
              </div>
            </div>
          </div>
        )}

      </div>{/* end centering wrapper */}

      <PageFooter onEula={() => setShowEula(true)} onFaq={() => setShowFaq(true)} />
      {showEula && <EulaModal onClose={() => setShowEula(false)} />}
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}
    </div>
  );
}
