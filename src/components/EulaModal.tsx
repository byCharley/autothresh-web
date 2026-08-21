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
            Terms of Use — AutoThresh Web
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

          <Section title="Subscription &amp; Users">
            Each AutoThresh™ subscription is licensed to a single user only. Sharing
            your account, login credentials, or access with any other person is strictly
            prohibited. If we determine that an account is being shared — regardless of
            intent — the subscription will be permanently banned with no exceptions and
            no refund. There is no appeal process for account-sharing violations.
          </Section>

          <Section title="One-Time Lifetime Purchase">
            AutoThresh Web offers a one-time lifetime purchase option that grants access
            to the application for as long as the service remains operational. "Lifetime"
            refers to the lifetime of the AutoThresh Web application itself — not any
            guaranteed minimum period. We make no commitment to keep the service running
            indefinitely, and access may be discontinued if the application is sunset,
            retired, or otherwise terminated. In such an event, no refund or compensation
            will be issued. By purchasing lifetime access, you acknowledge and accept
            these terms. Lifetime access is non-transferable and licensed to a single
            user only, subject to the same account-sharing restrictions as all other plans.
          </Section>

          <Section title="Refund Policy">
            All purchases — including subscriptions and one-time lifetime purchases — are
            final. We do not issue refunds under any circumstances. Please review your
            selected plan carefully before completing your purchase.
          </Section>

          <Section title="Cancellation">
            You can pause or cancel from your account menu (click your name) while signed in.
            Cancelling ends the subscription immediately and it will not renew. Purchases are
            final and we do not issue refunds for time already billed. After you cancel, this
            account will not open AutoThresh until you subscribe again. If you cannot use
            in-app billing, email{' '}
            <a href="mailto:autothreshweb@gmail.com" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              autothreshweb@gmail.com
            </a>{' '}
            at least 48 hours before renewal.
          </Section>

          <Section title="Acceptance">
            By signing in and using AutoThresh Web you agree to these terms. If you
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
