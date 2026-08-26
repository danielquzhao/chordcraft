import { useState } from 'react'
import { useAuth } from './store'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signInWithEmail, signInWithGitHub } = useAuth.getState()

  async function sendLink(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const problem = await signInWithEmail(email.trim())
    setBusy(false)
    if (problem) setError(problem)
    else setSent(true)
  }

  async function github() {
    setError(null)
    const problem = await signInWithGitHub()
    if (problem) setError(problem)
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

        <div className="signin-or" aria-hidden="true"><span>or</span></div>
        <button type="button" className="tool text signin-github" onClick={() => void github()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
          </svg>
          Continue with GitHub
        </button>

        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </main>
  )
}
