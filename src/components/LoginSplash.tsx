import { useEffect, useState } from 'react';
import { AppIcon } from './AppIcon';

interface LoginSplashProps {
  firstName?: string;
  email?: string;
  onDone: () => void;
}

export function LoginSplash({ firstName, email, onDone }: LoginSplashProps) {
  const [phase, setPhase] = useState<'fill' | 'text' | 'out'>('fill');

  const displayName = firstName || email?.split('@')[0] || '';

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('text'), 1000);
    const t2 = setTimeout(() => setPhase('out'),  2200);
    const t3 = setTimeout(() => onDone(),          2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--bg, #111)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        opacity: phase === 'out' ? 0 : 1,
        transition: phase === 'out' ? 'opacity 0.6s ease' : 'none',
        pointerEvents: 'none',
      }}
    >
      <style>{`
        @keyframes at-logo-fill {
          from { clip-path: inset(100% 0 0 0); }
          to   { clip-path: inset(0%   0 0 0); }
        }
      `}</style>

      {/* Logo */}
      <div style={{ position: 'relative', width: 120, height: 120 }}>
        {/* Dim silhouette behind */}
        <AppIcon size={120} color="rgba(255,255,255,0.08)" />
        {/* Orange fill rising from bottom */}
        <div style={{
          position: 'absolute', inset: 0,
          animation: 'at-logo-fill 1.3s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
        }}>
          <AppIcon size={120} color="var(--accent, #FFC800)" />
        </div>
      </div>

      {/* Welcome text */}
      <div style={{
        marginTop: 36, textAlign: 'center',
        opacity: phase === 'fill' ? 0 : 1,
        transform: phase === 'fill' ? 'translateY(6px)' : 'translateY(0)',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
      }}>
        <div style={{
          fontSize: 24, fontWeight: 700,
          fontFamily: 'var(--font-mono)', color: 'var(--text)',
          letterSpacing: '-0.02em',
        }}>
          Hello{displayName ? `, ${displayName}` : ''}
        </div>
      </div>
    </div>
  );
}
