// Turns a measure's notes into the sequence of chords and rests a staff displays.
// Shared by the renderer, keyboard navigation and playback so they agree on positions.

import { toMidi } from './pitch'
import { measureTicks, type Measure, type Meta, type Note, type Staff } from './types'

export type StaffEvent = {
  start: number
  dur: number
  /** Notes sounding together, lowest first. Empty for a rest. */
  notes: Note[]
}

/**
 * Chords and rests for voice 1 of one staff, covering the whole measure.
 * Notes that start together form a chord lasting as long as its longest note. A note that starts
 * while an earlier chord still sounds is skipped (multi-voice writing arrives later).
 */
export function staffEvents(measure: Measure, staff: Staff, meta: Meta): StaffEvent[] {
  const length = measureTicks(meta)
  const groups = new Map<number, Note[]>()
  for (const note of measure.notes) {
    if (note.staff !== staff || note.voice !== 1) continue
    const group = groups.get(note.start)
    if (group) group.push(note)
    else groups.set(note.start, [note])
  }

  const events: StaffEvent[] = []
  let t = 0
  for (const start of [...groups.keys()].sort((a, b) => a - b)) {
    if (start < t) continue
    if (start > t) events.push({ start: t, dur: start - t, notes: [] })
    const notes = groups.get(start)!.sort((a, b) => toMidi(a.pitch) - toMidi(b.pitch))
    const dur = Math.min(Math.max(...notes.map((n) => n.dur)), length - start)
    events.push({ start, dur, notes })
    t = start + dur
  }
  if (t < length) events.push({ start: t, dur: length - t, notes: [] })
  return events
}

export type DurationToken = { duration: string; dots: number; ticks: number }

/** Notatable durations, longest first: dotted whole down to a 32nd. */
export function durationTokens(ppq: number): DurationToken[] {
  const plain: [string, number][] = [
    ['w', ppq * 4], ['h', ppq * 2], ['q', ppq], ['8', ppq / 2], ['16', ppq / 4], ['32', ppq / 8],
  ]
  return plain
    .flatMap(([duration, ticks]): DurationToken[] => [
      { duration, dots: 1, ticks: ticks * 1.5 },
      { duration, dots: 0, ticks },
    ])
    .filter((t) => Number.isInteger(t.ticks) && !(t.duration === '32' && t.dots === 1))
}

/** Split a length into notatable pieces, longest first (the pieces of a note are tied). */
export function decompose(ticks: number, ppq: number): DurationToken[] {
  const pieces: DurationToken[] = []
  let left = ticks
  for (const token of durationTokens(ppq)) {
    while (left >= token.ticks) {
      pieces.push(token)
      left -= token.ticks
    }
  }
  return pieces
}
