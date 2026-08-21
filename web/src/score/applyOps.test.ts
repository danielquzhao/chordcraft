import { describe, expect, it } from 'vitest'
import cases from '../../../fixtures/ops_cases.json'
import sketchJson from '../../../fixtures/autumn-sketch.json'
import { applyOps, OpError } from './applyOps'
import type { Op, Score } from './types'

const base = cases.base as Score
const sketch = sketchJson as Score

describe('shared op cases (fixtures/ops_cases.json)', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const before = structuredClone(base)
      const run = () => applyOps(base, c.ops as Op[])
      if ('error' in c && c.error) {
        try {
          run()
          expect.unreachable('expected an OpError')
        } catch (err) {
          expect(err).toBeInstanceOf(OpError)
          expect({ index: (err as OpError).index, code: (err as OpError).code }).toEqual(c.error)
        }
      } else {
        expect(run()).toEqual(c.score)
      }
      // Ops never mutate their input, even when they fail part-way.
      expect(base).toEqual(before)
    })
  }
})

describe('applyOps', () => {
  it('applies the walking bass edit from the design mockup', () => {
    const removed = sketch.measures
      .slice(4, 8)
      .flatMap((m) => m.notes.filter((n) => n.staff === 'LH').map((n) => n.id))
    const line = ['D3', 'E3', 'F#3', 'A3', 'B2', 'C#3', 'D3', 'F#3',
      'E3', 'G3', 'F#3', 'D3', 'A2', 'C#3', 'E3', 'G3']
    const ops: Op[] = [
      ...removed.map((id): Op => ({ op: 'remove_note', id })),
      ...line.map((pitch, k): Op => ({
        op: 'add_note',
        measure: 5 + Math.floor(k / 4),
        note: { id: `w${k}`, staff: 'LH', voice: 1, pitch, start: (k % 4) * 480, dur: 480, tie: false },
      })),
    ]
    const result = applyOps(sketch, ops)
    const bass = result.measures
      .slice(4, 8)
      .map((m) => m.notes.filter((n) => n.staff === 'LH').map((n) => n.pitch))
    expect(bass).toEqual([line.slice(0, 4), line.slice(4, 8), line.slice(8, 12), line.slice(12)])
    expect(result.measures.slice(0, 4)).toEqual(sketch.measures.slice(0, 4))
  })

  it('rejects malformed pitches', () => {
    const op: Op = {
      op: 'add_note',
      measure: 1,
      note: { id: 'x', staff: 'RH', voice: 1, pitch: 'H4', start: 0, dur: 480, tie: false },
    }
    expect(() => applyOps(sketch, [op])).toThrow(OpError)
  })
})
