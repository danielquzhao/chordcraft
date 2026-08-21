import { describe, expect, it } from 'vitest'
import { diatonicIndex, fromDiatonic, keyAlter, keyFifths, parsePitch, toMidi } from './pitch'

describe('pitch', () => {
  it.each([
    ['C4', 60], ['A0', 21], ['C8', 108], ['F#3', 54], ['Gb3', 54], ['B#3', 60], ['Cbb4', 58],
  ])('toMidi(%s) = %i', (name, midi) => {
    expect(toMidi(name)).toBe(midi)
  })

  it.each(['H4', 'C9', 'c4', 'C#', 'F###3', ''])('rejects %j', (name) => {
    expect(() => parsePitch(name)).toThrow()
  })

  it('knows key signatures', () => {
    expect(keyFifths('D', 'major')).toBe(2)
    expect(keyFifths('Bb', 'major')).toBe(-2)
    expect(keyFifths('B', 'minor')).toBe(2)
    expect(() => keyFifths('Fb', 'major')).toThrow()
    expect([...'CDEFGAB'].map((s) => keyAlter(s, 2))).toEqual([1, 0, 0, 1, 0, 0, 0])
    expect([...'CDEFGAB'].map((s) => keyAlter(s, -3))).toEqual([0, 0, -1, 0, 0, -1, -1])
  })

  it('steps diatonically within a key', () => {
    expect(diatonicIndex('C4')).toBe(28)
    expect(fromDiatonic(diatonicIndex('E3') + 1, 2)).toBe('F#3')
    expect(fromDiatonic(diatonicIndex('B3') + 1, 2)).toBe('C#4')
    expect(fromDiatonic(diatonicIndex('C4') - 1, -1)).toBe('Bb3')
  })
})
