import { describe, expect, it } from 'vitest'
import sketchJson from '../../../fixtures/autumn-sketch.json'
import { applyOps } from './applyOps'
import { diffScores } from './diff'
import type { Score } from './types'

const sketch = sketchJson as Score

describe('diffScores', () => {
  it('finds added, removed and changed notes', () => {
    const after = applyOps(sketch, [
      { op: 'remove_note', id: 'n_m5lh1' },
      {
        op: 'add_note',
        measure: 5,
        note: { id: 'w1', staff: 'LH', voice: 1, pitch: 'D3', start: 0, dur: 480, tie: false },
      },
      { op: 'update_note', id: 'n_m1rh1', set: { pitch: 'G4' } },
    ])
    const diff = diffScores(sketch, after)
    expect([...diff.added].sort()).toEqual(['n_m1rh1', 'w1'])
    expect(diff.removedCount).toBe(2)
    expect(diff.removed.get(5)?.map((n) => n.pitch)).toEqual(['D3'])
    // The changed note's old version is a ghost in its measure.
    expect(diff.removed.get(1)?.map((n) => n.pitch)).toEqual(['F#4'])
  })

  it('is empty for identical scores', () => {
    const diff = diffScores(sketch, structuredClone(sketch))
    expect(diff.added.size).toBe(0)
    expect(diff.removedCount).toBe(0)
  })
})
