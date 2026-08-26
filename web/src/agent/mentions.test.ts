import { describe, expect, it } from 'vitest'
import { describeSelection, mentionInProgress, parseMentions } from './mentions'

const ctx = { measureCount: 8, range: null }

describe('parseMentions', () => {
  it('reads measure ranges in their common spellings', () => {
    expect(parseMentions('@m.5–8 walking bass', ctx)).toEqual({ start: 5, end: 8, staves: ['RH', 'LH'] })
    expect(parseMentions('@m5-8 walking bass', ctx)).toMatchObject({ start: 5, end: 8 })
    expect(parseMentions('fix @m3', ctx)).toMatchObject({ start: 3, end: 3 })
    expect(parseMentions('compare @m2 with @m.6', ctx)).toMatchObject({ start: 2, end: 6 })
  })

  it('reads hands', () => {
    expect(parseMentions('@LH busier', ctx).staves).toEqual(['LH'])
    expect(parseMentions('@right and @left', ctx).staves).toEqual(['RH', 'LH'])
  })

  it('falls back to the selected measures, then the whole score', () => {
    expect(parseMentions('busier please', ctx)).toEqual({ start: 1, end: 8, staves: ['RH', 'LH'] })
    expect(parseMentions('busier', { ...ctx, range: { start: 3, end: 4 } })).toMatchObject({ start: 3, end: 4 })
    expect(parseMentions('@all busier', { ...ctx, range: { start: 3, end: 4 } })).toMatchObject({ start: 1, end: 8 })
  })

  it('clamps to the score', () => {
    expect(parseMentions('@m7-12', ctx)).toMatchObject({ start: 7, end: 8 })
  })
})

describe('helpers', () => {
  it('describes a selection', () => {
    expect(describeSelection({ start: 5, end: 8, staves: ['LH'] }, 8)).toBe('m. 5–8 · left hand')
    expect(describeSelection({ start: 1, end: 8, staves: ['RH', 'LH'] }, 8)).toBe('whole score · both hands')
  })

  it('finds a mention being typed', () => {
    expect(mentionInProgress('make @m.5')).toBe('@m.5')
    expect(mentionInProgress('@')).toBe('@')
    expect(mentionInProgress('email me@x.com later')).toBeNull()
  })
})
