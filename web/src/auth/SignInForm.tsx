import { useState } from 'react'
import { useAuth } from './store'

/** Email, then the emailed code. Signing in swaps the whole screen for the editor. */
export function SignInForm({ emailId }: { emailId: string }) {
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
    <div className="signin-form">
      {sent ? (
        <form onSubmit={(e) => void checkCode(e)} className="signin-row">
          <p className="signin-note" role="status">
            We sent a code to <strong>{email}</strong>.{' '}
            <button type="button" className="signin-link" onClick={startOver}>
              Use a different email
            </button>
          </p>
          <label htmlFor="signin-code" className="sr-only">Sign-in code</label>
          <input
            id="signin-code"
            className="signin-input signin-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Code"
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
          />
          <button type="submit" className="signin-submit" disabled={busy || code.length < 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void sendCode(e)} className="signin-row">
          <label htmlFor={emailId} className="sr-only">Email</label>
          <input
            id={emailId}
            className="signin-input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="signin-submit" disabled={busy}>
            {busy ? 'Sending…' : 'Start composing'}
          </button>
        </form>
      )}
      {error && <p className="signin-error" role="alert">{error}</p>}
    </div>
  )
}
