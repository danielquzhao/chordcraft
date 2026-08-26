// @-mentions in chat: point the agent at measures and hands.
//   @m5  @m.5  @m5-8  @m.5–8   measures        @all          the whole score
//   @RH  @LH   @right @left    hands
// Without mentions, a message covers the selected measures (or the whole score), both hands.

import type { Selection } from '../api/client'

const MEASURES = /@m\.?\s?(\d+)(?:\s?[-–]\s?(\d+))?/gi
const HANDS = /@(rh|lh|right|left)\b/gi
const ALL = /@all\b/i

export type MentionContext = {
  measureCount: number
  range: { start: number; end: number } | null
}

export function parseMentions(text: string, ctx: MentionContext): Selection {
  let start: number | null = null
  let end: number | null = null
  for (const match of text.matchAll(MEASURES)) {
    const a = Number(match[1])
    const b = match[2] ? Number(match[2]) : a
    start = Math.min(start ?? Infinity, a, b)
    end = Math.max(end ?? -Infinity, a, b)
  }
  if (start === null || end === null) {
    if (ALL.test(text) || !ctx.range) [start, end] = [1, ctx.measureCount]
    else [start, end] = [ctx.range.start, ctx.range.end]
  }
  start = Math.max(1, Math.min(start, ctx.measureCount))
  end = Math.max(start, Math.min(end, ctx.measureCount))

  const hands = new Set<'RH' | 'LH'>()
  for (const match of text.matchAll(HANDS)) {
    hands.add(/^(rh|right)$/i.test(match[1]) ? 'RH' : 'LH')
  }
  const staves: ('RH' | 'LH')[] = hands.size ? (['RH', 'LH'] as const).filter((h) => hands.has(h)) : ['RH', 'LH']
  return { start, end, staves }
}

/** "m. 5–8 · L.H." for the composer's context line. */
export function describeSelection(sel: Selection, measureCount?: number): string {
  const bars =
    sel.start === 1 && sel.end === measureCount
      ? 'whole score'
      : sel.start === sel.end
        ? `m. ${sel.start}`
        : `m. ${sel.start}–${sel.end}`
  const hands = sel.staves.length === 2 ? 'both hands' : sel.staves[0] === 'RH' ? 'right hand' : 'left hand'
  return `${bars} · ${hands}`
}

/** The @word being typed at the end of the text, if any (for suggestions). */
export function mentionInProgress(text: string): string | null {
  const match = /(?:^|\s)(@[\w.\-–]*)$/.exec(text)
  return match ? match[1] : null
}

export function mentionSuggestions(ctx: MentionContext & { cursorMeasure: number }): string[] {
  const out: string[] = []
  if (ctx.range && ctx.range.start !== ctx.range.end) out.push(`@m.${ctx.range.start}–${ctx.range.end}`)
  out.push(`@m.${ctx.cursorMeasure}`, '@RH', '@LH', '@all')
  return out
}
