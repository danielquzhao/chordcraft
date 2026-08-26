import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgent } from '../agent/store'
import { api, ApiError } from '../api/client'
import { ScoreView } from '../render/ScoreView'
import { parseProgression } from '../score/chords'
import { MAJOR_KEYS, MINOR_KEYS } from '../score/pitch'
import type { Mode, Score } from '../score/types'
import { Sidebar } from './Sidebar'
import { useEditor } from './store'

type Start = 'blank' | 'chords' | 'import'

const MAX_BARS = 64
const TIMES: [number, number][] = [[4, 4], [3, 4], [6, 8], [2, 4]]
const STYLES = {
  block: { label: 'Block chords', text: 'half-note block chords, voiced openly so they don’t sound muddy' },
  broken: { label: 'Broken chords', text: 'eighth-note broken chords' },
  fifths: { label: 'Root and fifth', text: 'root and fifth in half notes' },
  ballad: { label: 'Ballad arpeggios', text: 'flowing arpeggios that span each bar' },
} as const
type Style = keyof typeof STYLES

const KEY_OPTIONS = [
  ...Object.keys(MAJOR_KEYS).map((k) => ({ key: k, mode: 'major' as Mode })),
  ...Object.keys(MINOR_KEYS).map((k) => ({ key: k, mode: 'minor' as Mode })),
]
const pretty = (key: string) => key.replace('b', '♭').replace('#', '♯')

function blankScore(title: string, key: string, mode: Mode, time: [number, number], tempo: number, bars: number, chords: (string | null)[] = []): Score {
  return {
    meta: { title: title.trim() || 'Untitled score', key, mode, time, tempo, ppq: 480 },
    measures: Array.from({ length: bars }, (_, i) => ({
      n: i + 1,
      chord: chords[i] ?? null,
      section: null,
      notes: [],
    })),
  }
}

export function NewScore() {
  const [start, setStart] = useState<Start>('blank')
  const [title, setTitle] = useState('')
  const [keyChoice, setKeyChoice] = useState('C major')
  const [time, setTime] = useState('4/4')
  const [tempo, setTempo] = useState(92)
  const [bars, setBars] = useState(8)
  const [progression, setProgression] = useState('D | Bm | G | A | Dmaj7 | Bm7 | Em7 | A7')
  const [style, setStyle] = useState<Style>('broken')
  const [melody, setMelody] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const [key, mode] = keyChoice.split(' ') as [string, Mode]
  const meter = time.split('/').map(Number) as [number, number]
  const parsed = useMemo(() => parseProgression(progression), [progression])
  // A two-bar preview of the empty staves in the chosen key and meter.
  const preview = useMemo(() => {
    const [beats, unit] = time.split('/').map(Number)
    return blankScore(title, key, mode, [beats, unit], tempo, 2)
  }, [title, key, mode, time, tempo])

  // B / C / I pick a starting point, as the cards show.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const pick = ({ b: 'blank', c: 'chords', i: 'import' } as const)[e.key.toLowerCase() as 'b' | 'c' | 'i']
      if (pick) setStart(pick)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
      setError(detail?.message ?? 'Something went wrong. Check that the API is running and try again.')
    } finally {
      setBusy(false)
    }
  }

  const createBlank = () =>
    run(() => useEditor.getState().createScore(blankScore(title, key, mode, meter, tempo, bars)))

  const createFromChords = () =>
    run(async () => {
      const chords = parsed.chords.slice(0, MAX_BARS)
      const score = blankScore(title || 'Chord sketch', parsed.key, parsed.mode, meter, tempo, chords.length, chords)
      await useEditor.getState().createScore(score)
      // The agent writes the part; it lands as a ghost-note draft to accept or tweak.
      const right = melody
        ? 'Right hand: a simple, singable melody that fits the chords.'
        : 'Leave the right hand empty.'
      await useAgent
        .getState()
        .request(
          `Write a simple piano part for this chord progression, one chord per bar. Left hand: ${STYLES[style].text}. ${right}`,
          { start: 1, end: chords.length, staves: melody ? ['RH', 'LH'] : ['LH'] },
        )
    })

  const importFile = (file: File) =>
    run(async () => {
      const detail = await api.importScore(file)
      await useEditor.getState().open(detail.id)
    })

  const chordsReady = parsed.chords.length > 0 && parsed.invalid.length === 0

  return (
    <div className="app">
      <Sidebar />
      <main className="new-score">
        <div className="new-card">
          <header className="new-header">
            <h1>Start a new score</h1>
            <p>Piano, one grand staff. Pick a starting point; you can change all of this later.</p>
          </header>

          <div className="start-options" role="group" aria-label="Starting point">
            {(
              [
                ['blank', 'B', 'Blank score', 'Empty staves in your key and meter. Write notes yourself, then edit with the agent.'],
                ['chords', 'C', 'From chords', 'Type a progression. The agent writes a simple piano part you can shape from there.'],
                ['import', 'I', 'Import', 'Bring in MusicXML or MIDI from MuseScore, Sibelius, Logic or anywhere else.'],
              ] as const
            ).map(([value, hotkey, label, help]) => (
              <button
                key={value}
                type="button"
                className="start-option"
                aria-pressed={start === value}
                onClick={() => setStart(value)}
              >
                <span className="start-top">
                  <span className="start-label">{label}</span>
                  <span className="kbd">{hotkey}</span>
                </span>
                <span className="start-help">{help}</span>
              </button>
            ))}
          </div>

          {start === 'blank' && (
            <section className="start-panel" aria-label="Blank score settings">
              <div className="fields">
                <label>
                  Title
                  <input className="field" value={title} placeholder="Untitled score" maxLength={200} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label>
                  Key
                  <select className="field" value={keyChoice} onChange={(e) => setKeyChoice(e.target.value)}>
                    {KEY_OPTIONS.map((k) => (
                      <option key={`${k.key} ${k.mode}`} value={`${k.key} ${k.mode}`}>
                        {pretty(k.key)} {k.mode}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Time
                  <select className="field" value={time} onChange={(e) => setTime(e.target.value)}>
                    {TIMES.map(([b, u]) => (
                      <option key={`${b}/${u}`}>{`${b}/${u}`}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tempo (♩)
                  <input className="field" type="number" min={20} max={400} value={tempo} onChange={(e) => setTempo(Number(e.target.value) || 92)} />
                </label>
                <label>
                  Measures
                  <input className="field" type="number" min={1} max={MAX_BARS} value={bars} onChange={(e) => setBars(Math.max(1, Math.min(MAX_BARS, Number(e.target.value) || 1)))} />
                </label>
              </div>
              <div className="start-preview">
                <ScoreView score={preview} readOnly hostRef={previewRef} />
              </div>
            </section>
          )}

          {start === 'chords' && (
            <section className="start-panel" aria-label="From chords">
              <label className="stacked">
                Chord progression <span className="muted">· separate bars with |</span>
                <textarea
                  className="field progression"
                  rows={2}
                  value={progression}
                  onChange={(e) => setProgression(e.target.value)}
                />
              </label>
              <div className="chord-options">
                {chordsReady ? (
                  <span className="detected">
                    {Math.min(parsed.chords.length, MAX_BARS)} bars · {pretty(parsed.key)} {parsed.mode} detected
                  </span>
                ) : (
                  <span className="detected bad" role="alert">
                    {parsed.invalid.length
                      ? `Not chords: ${parsed.invalid.join(', ')}`
                      : 'Type a chord per bar, like D | Bm | G | A'}
                  </span>
                )}
                <label>
                  Left hand
                  <select className="field" value={style} onChange={(e) => setStyle(e.target.value as Style)}>
                    {Object.entries(STYLES).map(([value, s]) => (
                      <option key={value} value={value}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={melody} onChange={(e) => setMelody(e.target.checked)} /> Add a simple melody
                </label>
              </div>
              <p className="muted">
                You’ll land in the editor with the part as a draft, so you can accept it or ask
                for changes. This uses the agent (a few cents per run).
              </p>
            </section>
          )}

          {start === 'import' && (
            <section className="start-panel" aria-label="Import a file">
              <label
                className={dragging ? 'dropzone dragging' : 'dropzone'}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  const file = e.dataTransfer.files[0]
                  if (file) void importFile(file)
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                </svg>
                <span className="drop-title">{busy ? 'Importing…' : 'Drop a file here, or click to browse'}</span>
                <span className="muted">.musicxml, .xml, .mxl or .mid · up to 2 MB · parts become right and left hand</span>
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  accept=".musicxml,.xml,.mxl,.mid,.midi"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void importFile(file)
                    e.target.value = ''
                  }}
                />
              </label>
            </section>
          )}

          {error && <p className="error-text" role="alert">{error}</p>}

          {start !== 'import' && (
            <footer className="new-footer">
              <span className="muted">Not sure? Start blank. You can import or add chords any time.</span>
              {start === 'blank' ? (
                <button type="button" className="primary" onClick={() => void createBlank()} disabled={busy}>
                  {busy ? 'Creating…' : 'Create score'}
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => void createFromChords()} disabled={busy || !chordsReady}>
                  {busy ? 'Starting…' : 'Write piano part'}
                </button>
              )}
            </footer>
          )}
        </div>
      </main>
    </div>
  )
}
