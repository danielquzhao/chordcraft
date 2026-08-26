// Parsing a typed chord progression ("D | Bm | G | A7") for the "From chords" start.

import { MAJOR_KEYS, MINOR_KEYS } from './pitch'
import type { Mode } from './types'

// Root, optional accidental, then quality/extensions and an optional slash bass.
const CHORD = /^([A-G])(#|b)?((?:maj|min|m|dim|aug|sus|add|ø|°|\+|-|M|\d|\(|\)|b|#|alt)*)(?:\/([A-G](?:#|b)?))?$/

export type Progression = {
  chords: string[]
  /** Tokens that don't look like chord symbols. */
  invalid: string[]
  key: string
  mode: Mode
}

/** Bars split on "|"; without bars, every space-separated chord is its own bar. */
export function parseProgression(text: string): Progression {
  const tokens = (text.includes('|') ? text.split('|') : text.split(/\s+/))
    .map((t) => t.trim())
    .filter(Boolean)
  const chords: string[] = []
  const invalid: string[] = []
  for (const token of tokens) {
    if (CHORD.test(token)) chords.push(token)
    else invalid.push(token)
  }
  const { key, mode } = guessKey(chords[0])
  return { chords, invalid, key, mode }
}

/** The first chord usually names the key: its root, minor if the chord is minor. */
export function guessKey(chord: string | undefined): { key: string; mode: Mode } {
  const match = chord ? CHORD.exec(chord) : null
  if (!match) return { key: 'C', mode: 'major' }
  const root = match[1] + (match[2] ?? '')
  const quality = match[3] ?? ''
  const minor = /^(m(?!aj)|min|-)/.test(quality)
  const table = minor ? MINOR_KEYS : MAJOR_KEYS
  if (root in table) return { key: root, mode: minor ? 'minor' : 'major' }
  return { key: 'C', mode: 'major' }
}
