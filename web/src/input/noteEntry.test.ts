import { describe, expect, it } from 'vitest'
import sketchJson from '../../../fixtures/autumn-sketch.json'
import { applyOps } from '../score/applyOps'
import type { Score } from '../score/types'
import {
  addChordTone,
  deleteNote,
  moveCursor,
  nearestPitch,
  setNoteDuration,
  switchStaff,
  transpose,
  writeNote,
  type Cursor,
} from './noteEntry'

const sketch = sketchJson as Score
const empty: Score = {
  meta: { ...sketch.meta },
  measures: [{ n: 1, chord: null, section: null, notes: [] }],
}
const pitches = (s: Score, n: number, staff = 'RH') =>
  s.measures[n - 1].notes.filter((x) => x.staff === staff).map((x) => [x.pitch, x.start, x.dur])

describe('nearestPitch', () => {
  it('picks the closest octave and spells it in the key', () => {
    expect(nearestPitch('F', 'D4', 2)).toBe('F#4')
    expect(nearestPitch('B', 'D4', 2)).toBe('B3')
    expect(nearestPitch('C', 'A4', 2)).toBe('C#5')
    expect(nearestPitch('B', 'C4', -1)).toBe('Bb3')
  })
})

describe('writeNote', () => {
  it('writes at the cursor and advances by the duration', () => {
    const at: Cursor = { measure: 1, staff: 'RH', tick: 0 }
    const r = writeNote(empty, at, 'D', 480, 'x1')
    const s = applyOps(empty, r.ops)
    expect(pitches(s, 1)).toEqual([['D5', 0, 480]]) // nearest D to the default B4
    expect(r.cursor).toEqual({ measure: 1, staff: 'RH', tick: 480 })
    expect(r.select).toBe('x1')
  })

  it('follows the previous note to choose the octave', () => {
    let s = empty
    let cursor: Cursor = { measure: 1, staff: 'LH', tick: 0 }
    for (const [i, step] of ['D', 'F', 'A', 'C'].entries()) {
      const r = writeNote(s, cursor, step, 480, `x${i}`)
      s = applyOps(s, r.ops)
      cursor = r.cursor
    }
    expect(pitches(s, 1, 'LH').map((p) => p[0])).toEqual(['D3', 'F#3', 'A3', 'C#4'])
  })

  it('overwrites notes in the way and trims one that overlaps the start', () => {
    // m4 RH: A4 half at 0, C#5 half at 960. Write a half at beat 2 (tick 480).
    const r = writeNote(sketch, { measure: 4, staff: 'RH', tick: 480 }, 'E', 960, 'x1')
    const s = applyOps(sketch, r.ops)
    // E4 is 3 steps below the preceding A4; E5 would be 4 above.
    expect(pitches(s, 4)).toEqual([['A4', 0, 480], ['E4', 480, 960]])
  })

  it('crosses the barline and adds a measure at the end of the score', () => {
    const r = writeNote(empty, { measure: 1, staff: 'RH', tick: 1440 }, 'G', 480, 'x1')
    const s = applyOps(empty, r.ops)
    expect(s.measures).toHaveLength(2)
    expect(r.cursor).toEqual({ measure: 2, staff: 'RH', tick: 0 })
  })

  it('clips a note that would cross the barline', () => {
    const r = writeNote(empty, { measure: 1, staff: 'RH', tick: 1440 }, 'G', 1920, 'x1')
    expect(pitches(applyOps(empty, r.ops), 1)).toEqual([['G4', 1440, 480]])
  })
})

describe('editing the selected note', () => {
  it('stacks a chord tone above it', () => {
    const r = addChordTone(sketch, { measure: 1, staff: 'RH', tick: 0 }, 'n_m1rh1', 'D', 'x1')!
    const s = applyOps(sketch, r.ops)
    expect(pitches(s, 1).slice(0, 2)).toEqual([['F#4', 0, 480], ['D5', 0, 480]])
  })

  it('transposes by step in the key, by octave, and by semitone', () => {
    const up = applyOps(sketch, transpose(sketch, 'n_m1rh1', 'step', 1)) // F#4 -> G4
    expect(pitches(up, 1)[0][0]).toBe('G4')
    const down = applyOps(sketch, transpose(sketch, 'n_m1rh2', 'step', -1)) // A4 -> G4
    expect(pitches(down, 1)[1][0]).toBe('G4')
    const oct = applyOps(sketch, transpose(sketch, 'n_m1rh1', 'octave', 1))
    expect(pitches(oct, 1)[0][0]).toBe('F#5')
    const flat = applyOps(sketch, transpose(sketch, 'n_m1rh1', 'semitone', -1))
    expect(pitches(flat, 1)[0][0]).toBe('F4')
  })

  it('will not leave the piano range', () => {
    const low: Score = applyOps(empty, [{
      op: 'add_note', measure: 1,
      note: { id: 'lo', staff: 'LH', voice: 1, pitch: 'A0', start: 0, dur: 480, tie: false },
    }])
    expect(transpose(low, 'lo', 'step', -1)).toEqual([])
  })

  it('lengthens a note over the next one', () => {
    const s = applyOps(sketch, setNoteDuration(sketch, 'n_m1rh1', 960))
    expect(pitches(s, 1)).toEqual([['F#4', 0, 960], ['D5', 960, 480], ['A4', 1440, 480]])
  })

  it('deletes and leaves the cursor in its place', () => {
    const r = deleteNote(sketch, 'n_m1rh2')!
    expect(pitches(applyOps(sketch, r.ops), 1)).toHaveLength(3)
    expect(r.cursor).toEqual({ measure: 1, staff: 'RH', tick: 480 })
  })
})

describe('navigation', () => {
  it('steps through notes and across barlines', () => {
    const end = moveCursor(sketch, { measure: 1, staff: 'RH', tick: 1440 }, 1)
    expect(end).toEqual({ cursor: { measure: 2, staff: 'RH', tick: 0 }, select: 'n_m2rh1' })
    const back = moveCursor(sketch, { measure: 2, staff: 'RH', tick: 0 }, -1)
    expect(back.select).toBe('n_m1rh4')
  })

  it('lands on rests with no selection', () => {
    const r = moveCursor(empty, { measure: 1, staff: 'RH', tick: 0 }, 1)
    expect(r).toEqual({ cursor: { measure: 1, staff: 'RH', tick: 0 }, select: null })
  })

  it('switches hands at the same point in the bar', () => {
    const r = switchStaff(sketch, { measure: 1, staff: 'RH', tick: 960 })
    expect(r).toEqual({ cursor: { measure: 1, staff: 'LH', tick: 0 }, select: 'n_m1lh1' })
  })
})
