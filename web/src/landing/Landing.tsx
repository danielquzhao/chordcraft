import { SignInForm } from '../auth/SignInForm'
import { DemoEdit } from './DemoEdit'
import './landing.css'

const REPO = 'https://github.com/danielquzhao/chordcraft'
const EMAIL_ID = 'landing-email'

/** What signed-out visitors see: one screen, with sign-in built into the hero. */
export function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M9 18V6l10-2v12" />
            <circle cx="6.5" cy="18" r="2.5" />
            <circle cx="16.5" cy="16" r="2.5" />
          </svg>
          ChordCraft
        </span>
        <nav aria-label="Main" className="landing-links">
          <a href={REPO} className="landing-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
            </svg>
            GitHub
          </a>
          <button
            type="button"
            className="landing-link strong"
            onClick={() => document.getElementById(EMAIL_ID)?.focus()}
          >
            Sign in
          </button>
        </nav>
      </header>

      <main className="landing-main">
        <div className="landing-hero">
          <h1>
            Describe the change.
            <br />
            <em>Review every note.</em>
          </h1>
          <p className="landing-lede">
            A piano score editor with a composing partner. Select a few bars, say what you want,
            and accept the draft only if it sounds right.
          </p>
          <SignInForm emailId={EMAIL_ID} />
          <a href={REPO} className="landing-link small">
            Free and open source. Read the code on GitHub
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
        </div>

        <DemoEdit />
      </main>

      <footer className="landing-footer">
        <ul aria-label="Keyboard shortcuts">
          <li><kbd>⌘K</kbd>Describe an edit</li>
          <li><kbd>⌘↵</kbd>Accept it</li>
          <li><kbd>Tab</kbd>Suggest the next bar</li>
        </ul>
      </footer>
    </div>
  )
}
