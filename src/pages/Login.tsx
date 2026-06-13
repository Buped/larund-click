import { useState } from 'react';
import { signIn } from '../lib/auth';
import type { AuthUser } from '../lib/auth';
import { ClickMark } from '../components/icons';

async function openExternal(url: string) {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-md)',
  borderRadius: 9,
  padding: '11px 14px',
  fontSize: 14,
  color: 'var(--text-primary)',
  outline: 'none',
  fontFamily: 'var(--font)',
  boxSizing: 'border-box',
  display: 'block',
};

export function LoginScreen({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [email,    setEmail   ] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd ] = useState(false);
  const [loading,  setLoading ] = useState(false);
  const [error,    setError   ] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      const user = await signIn(email.trim(), password);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, justifyContent: 'center' }}>
          <ClickMark size={32} radius={10} glow />
          <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Larund Click</span>
        </div>

        <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-muted)', marginBottom: 32 }}>
          Sign in to your Larund account
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
            style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-md)')}
          />

          <div style={{ position: 'relative' }}>
            <input
              type={showPwd ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{ ...inputStyle, paddingRight: 44 }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border-md)')}
            />
            <button
              type="button"
              onClick={() => setShowPwd(v => !v)}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-hint)', fontSize: 12, fontFamily: 'var(--font)',
                padding: '2px 4px',
              }}
            >
              {showPwd ? 'Hide' : 'Show'}
            </button>
          </div>

          {error && (
            <div style={{
              fontSize: 13, color: 'var(--danger)',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger-border)',
              borderRadius: 8, padding: '10px 12px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="btn btn-primary"
            style={{
              width: '100%', height: 44, fontSize: 14, fontWeight: 600,
              marginTop: 4, justifyContent: 'center',
              opacity: loading || !email.trim() || !password ? 0.6 : 1,
              cursor: loading || !email.trim() || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-hint)', marginTop: 20 }}>
          Don't have an account?{' '}
          <button
            onClick={() => openExternal('https://larund.com/register')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--accent)', fontSize: 13, fontFamily: 'var(--font)',
              textDecoration: 'underline', padding: 0,
            }}
          >
            Register at larund.com/register
          </button>
        </p>
      </div>
    </div>
  );
}
