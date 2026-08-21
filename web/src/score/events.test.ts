import { describe, expect, it } from 'vitest'
import sketchJson from '../../../fixtures/autumn-sketch.json'
import { decompose, staffEvents } from './events'
import type { Measure, Note, Score } from './types'

const sketch = sketchJson as Score
const meta = sketch.meta

const note = (id: string, pitch: string, start: number, dur: number): Note => ({
  id, staff: 'RH', voice: 1, pitch, start, dur, tie: false,
})
const shape = (m: Measure) =>
  staffEvents(m, 'RH', meta).map((e) => [e.start, e.dur, e.notes.map((n) => n.pitch)])

describe('staffEvents', () => {
  it('reads a full measure as notes', () => {
    expect(shape(sketch.measures[3])).toEqual([[0, 960, ['A4']], [960, 960, ['C#5']]])
  })

  it('fills gaps with rests', () => {
    const m: Measure = { n: 1, chord: null, section: null, notes: [note('a', 'C5', 480, 480)] }
    expect(shape(m)).toEqual([[0, 480, []], [480, 480, ['C5']], [960, 960, []]])
  })

  it('groups notes that start together into a chord, lowest first', () => {
    const m: Measure = {
      n: 1, chord: null, section: null,
      notes: [note('a', 'G4', 0, 960), note('b', 'C4', 0, 960), note('c', 'E4', 0, 480)],
    }
    expect(shape(m)).toEqual([[0, 960, ['C4', 'E4', 'G4']], [960, 960, []]])
  })

  it('an empty measure is one rest', () => {
    expect(shape({ n: 1, chord: null, section: null, notes: [] })).toEqual([[0, 1920, []]])
  })

  it('skips a note that starts inside a sounding chord', () => {
    const m: Measure = {
      n: 1, chord: null, section: null,
      notes: [note('a', 'C5', 0, 960), note('b', 'D5', 480, 480)],
    }
    expect(shape(m)).toEqual([[0, 960, ['C5']], [960, 960, []]])
  })
})

describe('decompose', () => {
  const names = (ticks: number) =>
    decompose(ticks, 480).map((t) => t.duration + '.'.repeat(t.dots))

  it.each([
    [1920, ['w']], [1440, ['h.']], [960, ['h']], [720, ['q.']], [480, ['q']], [240, ['8']],
    [600, ['q', '16']], [1200, ['h', '8']], [2400, ['w', 'q']],
  ])('%i ticks -> %j', (ticks, expected) => {
    expect(names(ticks)).toEqual(expected)
  })
})
