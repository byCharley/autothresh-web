import { useState } from 'react';
import type { FormEvent } from 'react';

interface Props {
  onLogin: (email: string, password: string) => Promise<string | null>;
}

export function LoginPage({ onLogin }: Props) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const err = await onLogin(email.trim(), password);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 36, textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
          AutoThresh Web <span style={{ color: 'var(--accent)' }}>Beta 1.0.0</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          Tonal Separation Tool
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        width: 360, maxWidth: '90vw', padding: '28px 24px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 20, fontFamily: 'var(--font-mono)' }}>
          Sign In
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
          <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" />

          {error && (
            <div style={{
              background: 'rgba(220,50,50,0.1)', border: '1px solid rgba(220,50,50,0.35)',
              padding: '8px 10px', fontSize: 11, color: '#e06060',
              fontFamily: 'var(--font-mono)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !email || !password}
            style={{ marginTop: 4, width: '100%', justifyContent: 'center', opacity: (loading || !email || !password) ? 0.5 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>
          Use your Charley Pangus store account.
        </div>
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange, placeholder }: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'current-password' : 'email'}
        style={{
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          outline: 'none', padding: '8px 10px', fontSize: 13, color: 'var(--text)',
          fontFamily: 'var(--font-sans)', width: '100%', boxSizing: 'border-box',
        }}
        onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={(e)  => (e.target.style.borderColor = 'var(--border)')}
      />
    </div>
  );
}
