import { useState } from 'react'
import { useAuth } from './store'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signInWithEmail } = useAuth.getState()

  async function sendLink(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const problem = await signInWithEmail(email.trim())
    setBusy(false)
    if (problem) setError(problem)
    else setSent(true)
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
          <p className="signin-sent" role="status">
            Check <strong>{email}</strong> for a sign-in link. You can close this tab once you’ve
            clicked it.
          </p>
        ) : (
          <form onSubmit={(e) => void sendLink(e)} className="signin-form">
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
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </main>
  )
}
