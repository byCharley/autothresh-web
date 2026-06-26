interface Props {
  onClose: () => void;
}

export function EulaModal({ onClose }: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        maxWidth: 540, width: '100%', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)' }}>
            Terms of Use — SepForge
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, lineHeight: 1 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.85, fontFamily: 'var(--font-sans)' }}>

          <Section title="Account Sharing">
            Your SepForge subscription is a single-user license. Sharing your
            login credentials with anyone else is strictly prohibited. If we detect
            that an account is being accessed by multiple users, the subscription
            will be immediately terminated and the associated IP address will be
            permanently banned from the platform. Deliberate or repeated violations
            may result in further legal action at our discretion.
          </Section>

          <Section title="Refund Policy">
            All subscription purchases are final. We do not issue refunds under any
            circumstances. Please review your subscription plan carefully before
            completing your purchase.
          </Section>

          <Section title="Cancellation">
            You are solely responsible for canceling your subscription before your
            next billing cycle renews. To request a cancellation, email us at{' '}
            <a href="mailto:info@charleypangus.com" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              info@charleypangus.com
            </a>{' '}
            prior to your renewal date. We recommend canceling at least 48 hours in
            advance to ensure processing time.
          </Section>

          <Section title="Acceptance">
            By signing in and using SepForge you agree to these terms. If you
            do not agree, please do not use the service.
          </Section>

        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
          <button
            className="btn btn-primary"
            onClick={onClose}
            style={{ width: '100%', color: '#000' }}
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
        color: 'var(--text)', marginBottom: 6,
      }}>
        {title}
      </div>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  );
}
