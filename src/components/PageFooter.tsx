interface Props {
  onEula: () => void;
}

const linkStyle: React.CSSProperties = {
  color: 'var(--text-dim)', textDecoration: 'none', opacity: 0.6,
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
  transition: 'opacity 0.15s',
};

export function PageFooter({ onEula }: Props) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      gap: 28, padding: '14px 20px',
    }}>
      <a
        href="https://charleypangus.com/pages/support"
        target="_blank" rel="noopener noreferrer"
        style={linkStyle}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
      >
        Support
      </a>

      <span style={{ width: 1, height: 10, background: 'var(--border)', opacity: 0.5 }} />

      <a
        href="https://charleypangus.com/pages/faq"
        target="_blank" rel="noopener noreferrer"
        style={linkStyle}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
      >
        FAQ
      </a>

      <span style={{ width: 1, height: 10, background: 'var(--border)', opacity: 0.5 }} />

      <button
        onClick={onEula}
        style={{ ...linkStyle, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
      >
        EULA
      </button>
    </div>
  );
}
