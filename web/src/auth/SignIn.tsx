import { useState } from 'react'
import { useAuth } from './store'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signInWithEmail, verifyCode } = useAuth.getState()

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const problem = await signInWithEmail(email.trim())
    setBusy(false)
    if (problem) setError(problem)
    else setSent(true)
  }

  async function checkCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const problem = await verifyCode(email.trim(), code)
    // On success the session arrives and this screen goes away.
    setBusy(false)
    if (problem) setError(problem)
  }

  function startOver() {
    setSent(false)
    setCode('')
    setError(null)
  }

  return (
    <main className="signin">
      <div className="signin-card">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M9 18V6l10-2v12" />
            <circle cx="6.5" cy="18" r="2.5" />
            <circle cx="16.5" cy="16" r="2.5" />
          </svg>
          ChordCraft
        </div>
        <h1>Sign in to your scores</h1>

        {sent ? (
          <form onSubmit={(e) => void checkCode(e)} className="signin-form">
            <p className="signin-sent" role="status">
              We sent a code to <strong>{email}</strong>.
            </p>
            <label htmlFor="signin-code">Code</label>
            <input
              id="signin-code"
              className="field signin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
            <button type="submit" className="primary" disabled={busy || code.length < 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="tool text signin-back" onClick={startOver}>
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void sendCode(e)} className="signin-form">
            <label htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              className="field"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="primary" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Email me a sign-in code'}
            </button>
          </form>
        )}

        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </main>
  )
}
