import { useState } from 'react'

// A hand-placed grand staff (measures 5–8 of "Autumn Sketch", D major) showing one pending
// agent edit. It only demonstrates the review flow; nothing here touches a real score.

type Note = [x: number, y: number, stem: 'up' | 'down']

const STAFF_LINES = [60, 70, 80, 90, 100, 160, 170, 180, 190, 200]
const BARLINES = [0.6, 315, 540, 765, 990]
const CHORDS: [number, string][] = [[114, 'Dmaj7'], [339, 'Bm7'], [564, 'Em7'], [789, 'A7']]

const MELODY: Note[] = [
  [216, 95, 'up'], [264, 85, 'up'], [441, 75, 'down'], [489, 80, 'down'],
  [570, 90, 'up'], [618, 80, 'down'], [666, 65, 'down'], [714, 70, 'down'],
]
const MELODY_HALVES: Note[] = [[120, 85, 'up'], [345, 70, 'down']]
const MELODY_WHOLE: [number, number] = [815, 75]

const OLD_BASS: [number, number][] = [[190, 180], [415, 190], [640, 175], [865, 195]]
const WALKING_BASS: Note[] = [
  [120, 180, 'down'], [168, 175, 'down'], [216, 170, 'down'], [264, 160, 'down'],
  [345, 190, 'up'], [393, 185, 'up'], [441, 180, 'down'], [489, 170, 'down'],
  [570, 175, 'down'], [618, 165, 'down'], [666, 170, 'down'], [714, 180, 'down'],
  [795, 195, 'up'], [843, 185, 'up'], [891, 175, 'down'], [939, 165, 'down'],
]

function stem([x, y, dir]: Note) {
  return dir === 'up'
    ? { x1: x + 5.6, y1: y - 1, x2: x + 5.6, y2: y - 34 }
    : { x1: x - 5.6, y1: y + 1, x2: x - 5.6, y2: y + 34 }
}

function Quarters({ notes }: { notes: Note[] }) {
  return notes.map((n) => (
    <g key={`${n[0]}-${n[1]}`}>
      <ellipse cx={n[0]} cy={n[1]} rx="6.2" ry="4.4" transform={`rotate(-20 ${n[0]} ${n[1]})`} />
      <line {...stem(n)} />
    </g>
  ))
}

function Halves({ notes }: { notes: Note[] }) {
  return notes.map((n) => (
    <g key={`${n[0]}-${n[1]}`}>
      <ellipse cx={n[0]} cy={n[1]} rx="6" ry="4.2" transform={`rotate(-20 ${n[0]} ${n[1]})`}
        fill="none" strokeWidth="1.8" />
      <line {...stem(n)} />
    </g>
  ))
}

function Wholes({ notes }: { notes: [number, number][] }) {
  return notes.map(([x, y]) => (
    <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="7.4" ry="4.6" fill="none" strokeWidth="2.4" />
  ))
}

type State = 'pending' | 'accepted' | 'rejected'

export function DemoEdit() {
  const [state, setState] = useState<State>('pending')
  const ink = 'var(--ink)'
  const added = 'var(--added)'

  return (
    <figure
      className="demo"
      aria-label="A pending edit: measures 5 to 8 with a walking bass drafted in blue"
    >
      {state === 'pending' && (
        <div className="demo-bar pending">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" className="demo-spark">
            <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />
          </svg>
          <span className="demo-chip">m. 5–8 · L.H.</span>
          <span className="demo-text">Turn the left hand into a walking bass</span>
          <span className="demo-count"><span className="plus">+16</span> <span className="minus">−4</span></span>
          <button type="button" className="demo-btn" onClick={() => setState('rejected')}>Reject</button>
          <button type="button" className="demo-btn accept" onClick={() => setState('accepted')}>Accept</button>
        </div>
      )}
      {state === 'accepted' && (
        <div className="demo-bar done">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
          <span className="demo-text">Saved as <strong>v13 · Walking bass</strong></span>
          <button type="button" className="demo-btn" onClick={() => setState('pending')}>Undo</button>
        </div>
      )}
      {state === 'rejected' && (
        <div className="demo-bar done">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          <span className="demo-text">Discarded. Your original bass line is back.</span>
          <button type="button" className="demo-btn" onClick={() => setState('pending')}>Show it again</button>
        </div>
      )}

      <svg viewBox="0 0 1000 230" className="demo-staff" role="img" aria-label="Measures 5 to 8, grand staff">
        <g stroke="#8a857b" strokeWidth="1">
          {STAFF_LINES.map((y) => <line key={y} x1="0" y1={y} x2="990" y2={y} />)}
        </g>
        <g stroke={ink} strokeWidth="1.2">
          {BARLINES.map((x) => <line key={x} x1={x} y1="60" x2={x} y2="200" />)}
        </g>
        <g fill={ink} fontFamily="'Noto Music', 'Apple Symbols', serif">
          <text x="6" y="98" fontSize="56">𝄞</text>
          <text x="6" y="191" fontSize="40">𝄢</text>
          <text x="40" y="66" fontSize="20">♯</text><text x="50" y="81" fontSize="20">♯</text>
          <text x="40" y="176" fontSize="20">♯</text><text x="50" y="191" fontSize="20">♯</text>
        </g>
        <text x="2" y="50" fill="var(--ink-2)" fontFamily="var(--font-sans)" fontSize="11">5</text>
        <g fill={ink} fontFamily="var(--font-sans)" fontWeight="600" fontSize="14">
          {CHORDS.map(([x, name]) => <text key={x} x={x} y="34">{name}</text>)}
        </g>

        <g fill={ink} stroke={ink} strokeWidth="1.3">
          <Halves notes={MELODY_HALVES} />
          <Quarters notes={MELODY} />
          <Wholes notes={[MELODY_WHOLE]} />
        </g>

        {state === 'rejected' && (
          <g stroke={ink}><Wholes notes={OLD_BASS} /></g>
        )}
        {state === 'pending' && (
          <>
            <rect x="86" y="140" width="908" height="84" rx="6" fill="rgba(35,80,200,0.05)"
              stroke="rgba(35,80,200,0.45)" strokeDasharray="4 3" />
            <g stroke="var(--removed)" fill="none" opacity="0.75">
              {OLD_BASS.map(([x, y]) => (
                <g key={x}>
                  <ellipse cx={x} cy={y} rx="7.4" ry="4.6" strokeWidth="2" strokeDasharray="2.5 2" />
                  <line x1={x - 10} y1={y + 6} x2={x + 10} y2={y - 6} strokeWidth="1.4" />
                </g>
              ))}
            </g>
          </>
        )}
        {state !== 'rejected' && (
          <g fill={state === 'pending' ? added : ink} stroke={state === 'pending' ? added : ink}
            strokeWidth="1.3">
            <Quarters notes={WALKING_BASS} />
          </g>
        )}
      </svg>
    </figure>
  )
}
