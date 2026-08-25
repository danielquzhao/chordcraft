import { useEffect, useRef } from 'react'
import type { AgentStep, Selection } from '../api/client'
import { currentSelection, useAgent, type Hands } from './store'

const HANDS: { value: Hands; label: string }[] = [
  { value: 'both', label: 'Both hands' },
  { value: 'RH', label: 'Right' },
  { value: 'LH', label: 'Left' },
]

function scopeLabel(sel: Selection): string {
  const bars = sel.start === sel.end ? `m. ${sel.start}` : `m. ${sel.start}–${sel.end}`
  const hands = sel.staves.length === 2 ? '' : sel.staves[0] === 'RH' ? ' · R.H.' : ' · L.H.'
  return bars + hands
}

/** One line of progress: what the agent is doing now, from its latest steps. */
function progress(steps: AgentStep[]): string {
  const edits = steps.filter((s) => ['add_note', 'remove_note', 'update_note', 'set_chord'].includes(s.name))
  const checks = steps.filter((s) => s.name === 'validate')
  const last = steps.at(-1)
  if (!last || last.name === 'read_score') return 'Reading the music…'
  if (last.name === 'validate') {
    return last.ok ? 'Checks passed, finishing up…' : 'Fixing problems the checks found…'
  }
  const fixes = checks.length ? ' (revising)' : ''
  return `Writing the edit${fixes} · ${edits.length} change${edits.length === 1 ? '' : 's'}`
}

function Sparkle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" className="sparkle">
      <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />
    </svg>
  )
}

export function EditBar() {
  const phase = useAgent((s) => s.phase)
  const instruction = useAgent((s) => s.instruction)
  const hands = useAgent((s) => s.hands)
  const selection = useAgent((s) => s.selection)
  const steps = useAgent((s) => s.steps)
  const proposal = useAgent((s) => s.proposal)
  const diff = useAgent((s) => s.diff)
  const error = useAgent((s) => s.error)
  const busy = useAgent((s) => s.busy)
  const { close, setInstruction, setHands, submit, accept, reject, open } = useAgent.getState()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (phase === 'composing') input.current?.focus()
  }, [phase])

  if (phase === 'idle') return null

  if (phase === 'composing') {
    return (
      <form
        className="editbar"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Sparkle />
        <span className="scope">{scopeLabel(currentSelection(hands))}</span>
        <label className="sr-only" htmlFor="edit-instruction">Describe the change</label>
        <input
          id="edit-instruction"
          ref={input}
          className="editbar-input"
          value={instruction}
          placeholder="Describe the change, e.g. “turn this into a walking bass”"
          maxLength={2000}
          autoComplete="off"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
        />
        <div className="group" role="group" aria-label="Hands to change">
          {HANDS.map((h) => (
            <button
              key={h.value}
              type="button"
              className="tool text"
              aria-pressed={hands === h.value}
              onClick={() => setHands(h.value)}
            >
              {h.label}
            </button>
          ))}
        </div>
        <button type="submit" className="primary" disabled={!instruction.trim()}>
          Edit <span className="kbd-inverse">↵</span>
        </button>
      </form>
    )
  }

  if (phase === 'running') {
    return (
      <div className="editbar" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        {selection && <span className="scope">{scopeLabel(selection)}</span>}
        <span className="editbar-text">
          <span className="instruction">{instruction}</span>
          <span className="muted">{progress(steps)}</span>
        </span>
        <button type="button" className="tool text" onClick={() => void reject()}>
          Cancel
        </button>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="editbar failed" role="alert">
        <span className="editbar-text">{error}</span>
        <button type="button" className="tool text" onClick={close}>Dismiss</button>
        <button type="button" className="primary" onClick={open}>Try again</button>
      </div>
    )
  }

  // Ready: the proposal is on the score as a ghost-note diff.
  const checks = proposal?.report?.checks ?? []
  const problems = checks.filter((c) => c.status !== 'pass')
  return (
    <div className="editbar ready" role="region" aria-label="Proposed edit">
      <div className="editbar-row">
        <Sparkle />
        {selection && <span className="scope">{scopeLabel(selection)}</span>}
        <span className="editbar-text">
          <span className="instruction">{proposal?.summary || instruction}</span>
        </span>
        {diff && (
          <span className="counts" aria-label={`${diff.added.size} notes added, ${diff.removedCount} removed`}>
            <span className="added">+{diff.added.size}</span> <span className="removed">−{diff.removedCount}</span>
          </span>
        )}
        <button type="button" className="tool text" onClick={() => void reject()} disabled={busy}>
          Reject <span className="kbd">⌘⌫</span>
        </button>
        <button type="button" className="primary" onClick={() => void accept()} disabled={busy}>
          Accept <span className="kbd-inverse">⌘↵</span>
        </button>
      </div>
      {problems.length > 0 && (
        <ul className="checks">
          {problems.flatMap((c) =>
            c.details.map((d) => (
              <li key={c.id + d} className={c.status}>
                <strong>{c.status === 'fail' ? 'Problem' : 'Note'}:</strong> {d}
              </li>
            )),
          )}
        </ul>
      )}
    </div>
  )
}
