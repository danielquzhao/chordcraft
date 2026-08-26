import { describe, expect, it } from 'vitest'
import { guessKey, parseProgression } from './chords'

describe('parseProgression', () => {
  it('splits bars on |', () => {
    const p = parseProgression('D | Bm | G | A | Dmaj7 | Bm7 | Em7 | A7')
    expect(p.chords).toEqual(['D', 'Bm', 'G', 'A', 'Dmaj7', 'Bm7', 'Em7', 'A7'])
    expect(p.invalid).toEqual([])
    expect([p.key, p.mode]).toEqual(['D', 'major'])
  })

  it('accepts space-separated chords and richer symbols', () => {
    const p = parseProgression('F#m7b5 B7 Em G/B Csus4 Bb(add9) Ebmaj7 Adim')
    expect(p.chords).toHaveLength(8)
    expect(p.invalid).toEqual([])
  })

  it('reports things that are not chords', () => {
    expect(parseProgression('C | hello | G').invalid).toEqual(['hello'])
  })
})

describe('guessKey', () => {
  it('uses the first chord', () => {
    expect(guessKey('Am7')).toEqual({ key: 'A', mode: 'minor' })
    expect(guessKey('Ebmaj7')).toEqual({ key: 'Eb', mode: 'major' })
    expect(guessKey('C-7')).toEqual({ key: 'C', mode: 'minor' })
  })

  it('falls back to C major for keys it cannot name', () => {
    expect(guessKey('Fb')).toEqual({ key: 'C', mode: 'major' })
    expect(guessKey(undefined)).toEqual({ key: 'C', mode: 'major' })
  })
})
