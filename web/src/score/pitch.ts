// Pitch spelling helpers. Mirrors api/app/score/pitch.py.

import type { Mode } from './types'

export const STEPS = 'CDEFGAB'
const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const ALTERS: Record<string, number> = { '': 0, '#': 1, '##': 2, b: -1, bb: -2 }
const ALTER_SYMBOLS: Record<number, string> = { 0: '', 1: '#', 2: '##', [-1]: 'b', [-2]: 'bb' }

export const PIANO_LOW = 21 // A0
export const PIANO_HIGH = 108 // C8

const PITCH_RE = /^([A-G])(##|#|bb|b)?([0-8])$/

export const MAJOR_KEYS: Record<string, number> = {
  Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0,
  G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
}
export const MINOR_KEYS: Record<string, number> = {
  Ab: -7, Eb: -6, Bb: -5, F: -4, C: -3, G: -2, D: -1, A: 0,
  E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
}
const SHARP_ORDER = 'FCGDAEB'
const FLAT_ORDER = 'BEADGCF'

export type Pitch = { step: string; alter: number; octave: number }

export function parsePitch(name: string): Pitch {
  const match = PITCH_RE.exec(name)
  if (!match) throw new Error(`invalid pitch ${JSON.stringify(name)}`)
  return { step: match[1], alter: ALTERS[match[2] ?? ''], octave: Number(match[3]) }
}

export function isValidPitch(name: string): boolean {
  return PITCH_RE.test(name)
}

export function formatPitch({ step, alter, octave }: Pitch): string {
  return `${step}${ALTER_SYMBOLS[alter]}${octave}`
}

export function toMidi(name: string): number {
  const p = parsePitch(name)
  return 12 * (p.octave + 1) + STEP_SEMITONES[p.step] + p.alter
}

export function diatonicIndex(name: string): number {
  const p = parsePitch(name)
  return p.octave * 7 + STEPS.indexOf(p.step)
}

export function keyFifths(key: string, mode: Mode): number {
  const table = mode === 'major' ? MAJOR_KEYS : MINOR_KEYS
  if (!(key in table)) throw new Error(`unknown ${mode} key ${JSON.stringify(key)}`)
  return table[key]
}

/** The accidental the key signature applies to a step (1 sharp, -1 flat, 0 natural). */
export function keyAlter(step: string, fifths: number): number {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(step)) return 1
  if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(step)) return -1
  return 0
}

/** Spell the note at a diatonic position using the key signature's accidental. */
export function fromDiatonic(index: number, fifths: number): string {
  const octave = Math.floor(index / 7)
  const step = STEPS[((index % 7) + 7) % 7]
  return formatPitch({ step, alter: keyAlter(step, fifths), octave })
}
