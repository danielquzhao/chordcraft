import { useCallback, useRef, useState } from 'react'
import { useKeyboard } from '../input/useKeyboard'
import { play, stop } from '../playback/player'
import { markNotes } from '../render/engrave'
import { ChatPanel } from '../agent/ChatPanel'
import { EditBar } from '../agent/EditBar'
import { agentLocksScore, useAgent } from '../agent/store'
import { ScoreView } from '../render/ScoreView'
import type { Staff } from '../score/types'
import { Sidebar } from './Sidebar'
import { useAutocomplete } from './useAutocomplete'
import { DURATIONS, saveStatus, useEditor, type SaveStatus } from './store'

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  offline: "Can't reach the server, retrying…",
}

/** The score title, edited in place; renaming is a set_meta op like any other edit. */
function TitleField({ title, readOnly }: { title: string; readOnly: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const apply = useEditor((s) => s.apply)
  const commit = () => {
    const next = draft?.trim()
    if (next && next !== title) apply([{ op: 'set_meta', set: { title: next.slice(0, 200) } }])
    setDraft(null)
  }
  return (
    <input
      className="title"
      aria-label="Score title"
      value={draft ?? title}
      readOnly={readOnly}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(null)
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
        }
      }}
    />
  )
}

// SMuFL code points in the Bravura font VexFlow already loads.
const NOTE_GLYPH: Record<number, string> = {
  120: '', 240: '', 480: '', 960: '', 1920: '',
}
const DOT_GLYPH = ''
const HAND: Record<Staff, string> = { RH: 'Right hand', LH: 'Left hand' }

type PlayState = 'idle' | 'loading' | 'playing'

export function Editor() {
  const current = useEditor((s) => s.score)
  const preview = useEditor((s) => s.preview)
  const status = useEditor(saveStatus)
  const notice = useEditor((s) => s.notice)
  const loadError = useEditor((s) => s.loadError)
  const cursor = useEditor((s) => s.cursor)
  const selected = useEditor((s) => s.selected)
  const duration = useEditor((s) => s.duration)
  const dotted = useEditor((s) => s.dotted)
  const range = useEditor((s) => s.range)
  const chatOpen = useEditor((s) => s.chatOpen)
  const view = useEditor((s) => s.view)
  const suggestion = useEditor((s) => s.suggestion)
  const suggestOn = useEditor((s) => s.suggestOn)
  const agentPhase = useAgent((s) => s.phase)
  const agentSelection = useAgent((s) => s.selection)
  const proposal = useAgent((s) => s.proposal)
  const diff = useAgent((s) => s.diff)
  const locked = agentLocksScore(agentPhase)
  const canUndo = useEditor((s) => s.past.length > 0) && !locked
  const canRedo = useEditor((s) => s.future.length > 0) && !locked
  const { undo, redo, setDuration, toggleDot, moveTo, restore, showRevision, dismissNotice } =
    useEditor.getState()

  const hostRef = useRef<HTMLDivElement>(null)
  const [playState, setPlayState] = useState<PlayState>('idle')
  const [audioError, setAudioError] = useState<string | null>(null)

  const togglePlay = useCallback(() => {
    const host = hostRef.current
    const showSounding = (ids: Iterable<string>) => host && markNotes(host, 'is-playing', ids)
    if (playState !== 'idle') {
      stop()
      showSounding([])
      setPlayState('idle')
      return
    }
    const state = useEditor.getState()
    const agent = useAgent.getState()
    const shown =
      state.preview?.score ??
      (agent.phase === 'ready' && agent.proposal ? agent.proposal.score : state.score)
    if (!shown) return
    setPlayState('loading')
    setAudioError(null)
    play(shown, state.preview ? 1 : state.cursor.measure, {
      onSounding: showSounding,
      onEnd: () => setPlayState('idle'),
    })
      .then(() => setPlayState('playing'))
      .catch(() => {
        setAudioError('Could not load the piano sounds. Check your connection and try again.')
        setPlayState('idle')
      })
  }, [playState])

  useKeyboard(togglePlay)
  useAutocomplete()

  // What's on the page: an old version, the agent's proposal, or the current score.
  const reviewing = agentPhase === 'ready' && proposal !== null
  const score =
    preview?.score ?? (reviewing ? proposal.score : (suggestion?.score ?? current))
  if (!score) {
    return (
      <div className="app">
        <Sidebar />
        <div className="editor">
          {loadError ? (
            <div className="load-error" role="alert">
              <p>{loadError} Check that the API is running, then try again.</p>
              <button type="button" className="primary" onClick={() => void useEditor.getState().init()}>
                Try again
              </button>
            </div>
          ) : (
            <p className="score-loading" style={{ padding: 24 }}>Loading score…</p>
          )}
        </div>
      </div>
    )
  }

  const readOnly = preview !== null || locked
  const { meta } = score
  const beatTicks = (meta.ppq * 4) / meta.time[1]
  const beat = Math.round((1 + cursor.tick / beatTicks) * 100) / 100
  const selectedPitch = selected
    ? score.measures.flatMap((m) => m.notes).find((n) => n.id === selected)?.pitch
    : null

  return (
    <div className="app">
    <Sidebar />
    <div className="editor">
      <header className="topbar">
        <h1 className="title-wrap">
          <TitleField key={meta.title} title={meta.title} readOnly={readOnly} />
        </h1>
        <div className="chips">
          <span className="chip">Piano</span>
          <span className="chip">
            {meta.key.replace('b', '♭').replace('#', '♯')} {meta.mode}
          </span>
          <span className="chip">{meta.time.join('/')}</span>
          <span className="chip mono">♩ = {meta.tempo}</span>
        </div>
        <div className="group" role="group" aria-label="View">
          {(['score', 'lead'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="tool text"
              aria-pressed={view === v}
              onClick={() => useEditor.getState().setView(v)}
            >
              {v === 'score' ? 'Score' : 'Lead sheet'}
            </button>
          ))}
        </div>
        <span className={`save-status ${status}`} role="status">
          {STATUS_TEXT[status]}
        </span>
        <button type="button" className="play" onClick={togglePlay} aria-pressed={playState !== 'idle'}>
          {playState === 'idle' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7 4v16l13-8z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 5h12v14H6z" />
            </svg>
          )}
          {playState === 'loading' ? 'Loading piano…' : playState === 'playing' ? 'Stop' : 'Play'}
          <span className="hint">Space</span>
        </button>
      </header>

      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="tool text" onClick={dismissNotice}>Dismiss</button>
        </div>
      )}

      {preview ? (
        <div className="preview-bar" role="region" aria-label="Viewing an earlier version">
          <span>
            Viewing <strong>v{preview.number}</strong> · {preview.message}
          </span>
          <span className="preview-actions">
            <button type="button" className="tool text" onClick={() => void showRevision(null)}>
              Back to current <span className="kbd">Esc</span>
            </button>
            <button type="button" className="primary" onClick={() => void restore(preview.number)}>
              Restore this version
            </button>
          </span>
        </div>
      ) : (
      <div className="toolbar" role="toolbar" aria-label="Note entry">
        <div className="group" role="group" aria-label="Note value">
          {DURATIONS.map((d) => (
            <button
              key={d.ticks}
              type="button"
              className="tool"
              aria-pressed={duration === d.ticks}
              aria-label={`${d.label} (${d.key})`}
              title={`${d.label} (${d.key})`}
              onClick={() => setDuration(d.ticks)}
            >
              <span className="glyph" aria-hidden="true">{NOTE_GLYPH[d.ticks]}</span>
              <span className="kbd">{d.key}</span>
            </button>
          ))}
          <button
            type="button"
            className="tool"
            aria-pressed={dotted}
            aria-label="Dotted (.)"
            title="Dotted (.)"
            onClick={toggleDot}
          >
            <span className="glyph" aria-hidden="true">{DOT_GLYPH}</span>
            <span className="kbd">.</span>
          </button>
        </div>

        {view === 'score' && (
        <div className="group" role="group" aria-label="Hand">
          {(['RH', 'LH'] as const).map((staff) => (
            <button
              key={staff}
              type="button"
              className="tool text"
              aria-pressed={cursor.staff === staff}
              onClick={() => moveTo({ cursor: { ...cursor, staff }, selected: null })}
            >
              {HAND[staff]}
            </button>
          ))}
        </div>
        )}

        <div className="group" role="group" aria-label="History">
          <button type="button" className="tool text" onClick={undo} disabled={!canUndo}>
            Undo <span className="kbd">⌘Z</span>
          </button>
          <button type="button" className="tool text" onClick={redo} disabled={!canRedo}>
            Redo <span className="kbd">⇧⌘Z</span>
          </button>
        </div>

        <button
          type="button"
          className="tool text"
          aria-pressed={suggestOn}
          title="Suggest the next bar as you write (Tab to accept)"
          onClick={() => useEditor.getState().toggleSuggest()}
        >
          Suggest <span className="kbd">Tab</span>
        </button>

        <button
          type="button"
          className="tool text ask"
          onClick={() => useAgent.getState().open()}
          disabled={locked}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />
          </svg>
          Ask agent <span className="kbd">⌘K</span>
        </button>
      </div>
      )}

      <main className="canvas">
        {!preview && <EditBar />}
        <article className="paper">
          <ScoreView
            score={score}
            readOnly={readOnly}
            hostRef={hostRef}
            diff={reviewing && !preview ? diff : null}
            highlight={preview ? null : locked ? agentSelection : range}
            view={view}
            suggested={suggestion && !preview && !reviewing ? suggestion.ids : null}
          />
        </article>
        {audioError && <p className="error" role="alert">{audioError}</p>}
      </main>

      <footer className="statusbar">
        <span>
          {suggestion ? (
            <span className="suggest-hint">
              Suggested bar · <span className="kbd">Tab</span> accept · <span className="kbd">Esc</span> dismiss ·{' '}
            </span>
          ) : null}
          m. {cursor.measure} · beat {beat} · {HAND[cursor.staff]}
          {selectedPitch && <> · <strong>{selectedPitch}</strong> selected</>}
        </span>
        <span className="shortcuts">
          <span><span className="kbd">A</span>–<span className="kbd">G</span> write</span>
          <span><span className="kbd">⇧</span>+letter chord</span>
          <span><span className="kbd">↑</span><span className="kbd">↓</span> pitch</span>
          <span><span className="kbd">←</span><span className="kbd">→</span> move</span>
          <span><span className="kbd">Tab</span> hand</span>
          <span><span className="kbd">⇧</span>+click bars</span>
          <span><span className="kbd">⌘K</span> ask agent</span>
          <span><span className="kbd">⌘L</span> chat</span>
        </span>
      </footer>
    </div>
    {chatOpen && <ChatPanel onClose={() => useEditor.getState().toggleChat()} />}
    </div>
  )
}
