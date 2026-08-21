import { useCallback, useRef, useState } from 'react'
import { useKeyboard } from '../input/useKeyboard'
import { play, stop } from '../playback/player'
import { markNotes } from '../render/engrave'
import { ScoreView } from '../render/ScoreView'
import type { Staff } from '../score/types'
import { DURATIONS, useEditor } from './store'
import './editor.css'

// SMuFL code points in the Bravura font VexFlow already loads.
const NOTE_GLYPH: Record<number, string> = {
  120: '', 240: '', 480: '', 960: '', 1920: '',
}
const DOT_GLYPH = ''
const HAND: Record<Staff, string> = { RH: 'Right hand', LH: 'Left hand' }

type PlayState = 'idle' | 'loading' | 'playing'

export function Editor() {
  const score = useEditor((s) => s.score)
  const cursor = useEditor((s) => s.cursor)
  const selected = useEditor((s) => s.selected)
  const duration = useEditor((s) => s.duration)
  const dotted = useEditor((s) => s.dotted)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const { undo, redo, setDuration, toggleDot, moveTo } = useEditor.getState()

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
    const { score: current, cursor: at } = useEditor.getState()
    setPlayState('loading')
    setAudioError(null)
    play(current, at.measure, {
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

  const { meta } = score
  const beatTicks = (meta.ppq * 4) / meta.time[1]
  const beat = Math.round((1 + cursor.tick / beatTicks) * 100) / 100
  const selectedPitch = selected
    ? score.measures.flatMap((m) => m.notes).find((n) => n.id === selected)?.pitch
    : null

  return (
    <div className="editor">
      <header className="topbar">
        <h1 className="title">{meta.title}</h1>
        <div className="chips">
          <span className="chip">Piano</span>
          <span className="chip">
            {meta.key.replace('b', '♭').replace('#', '♯')} {meta.mode}
          </span>
          <span className="chip">{meta.time.join('/')}</span>
          <span className="chip mono">♩ = {meta.tempo}</span>
        </div>
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

        <div className="group" role="group" aria-label="History">
          <button type="button" className="tool text" onClick={undo} disabled={!canUndo}>
            Undo <span className="kbd">⌘Z</span>
          </button>
          <button type="button" className="tool text" onClick={redo} disabled={!canRedo}>
            Redo <span className="kbd">⇧⌘Z</span>
          </button>
        </div>
      </div>

      <main className="canvas">
        <article className="paper">
          <ScoreView hostRef={hostRef} />
        </article>
        {audioError && <p className="error" role="alert">{audioError}</p>}
      </main>

      <footer className="statusbar">
        <span>
          m. {cursor.measure} · beat {beat} · {HAND[cursor.staff]}
          {selectedPitch && <> · <strong>{selectedPitch}</strong> selected</>}
        </span>
        <span className="shortcuts">
          <span><span className="kbd">A</span>–<span className="kbd">G</span> write</span>
          <span><span className="kbd">⇧</span>+letter chord</span>
          <span><span className="kbd">↑</span><span className="kbd">↓</span> pitch</span>
          <span><span className="kbd">←</span><span className="kbd">→</span> move</span>
          <span><span className="kbd">Tab</span> hand</span>
        </span>
      </footer>
    </div>
  )
}
