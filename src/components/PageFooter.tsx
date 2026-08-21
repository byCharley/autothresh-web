interface Props {
  onEula: () => void;
  onFaq?: () => void;
  onContact?: () => void;
}

const linkStyle: React.CSSProperties = {
  color: 'var(--text-dim)', textDecoration: 'none', opacity: 0.85,
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
  transition: 'opacity 0.15s',
  background: 'none', border: 'none', cursor: 'pointer', padding: '8px 4px',
};

export function PageFooter({ onEula, onFaq, onContact }: Props) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '4px 20px',
        width: '100%',
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
        boxSizing: 'border-box',
        zIndex: 2,
      }}
    >
      <button
        onClick={onContact}
        style={linkStyle}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
      >
        Support
      </button>

      <span style={{ width: 1, height: 10, background: 'var(--border)', opacity: 0.5, flexShrink: 0 }} />

      <button
        onClick={onFaq}
        style={linkStyle}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
      >
        FAQ
      </button>

      <span style={{ width: 1, height: 10, background: 'var(--border)', opacity: 0.5, flexShrink: 0 }} />

      <button
        onClick={onEula}
        style={linkStyle}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
      >
        EULA
      </button>
    </div>
  );
}
