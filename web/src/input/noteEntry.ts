// Keyboard note entry as pure functions: each command returns the ops to apply plus where the
// cursor and selection go next. The editor store applies the ops, so every manual edit flows
// through the same applyOps path as agent edits.

import { staffEvents, type StaffEvent } from '../score/events'
import {
  diatonicIndex,
  fromDiatonic,
  keyFifths,
  parsePitch,
  formatPitch,
  PIANO_HIGH,
  PIANO_LOW,
  STEPS,
  toMidi,
} from '../score/pitch'
import { measureTicks, type Note, type Op, type Score, type Staff } from '../score/types'

export type Cursor = { measure: number; staff: Staff; tick: number }

export type EntryResult = { ops: Op[]; cursor: Cursor; select: string | null }

const DEFAULT_REFERENCE: Record<Staff, string> = { RH: 'B4', LH: 'D3' }

function inRange(pitch: string): boolean {
  const midi = toMidi(pitch)
  return midi >= PIANO_LOW && midi <= PIANO_HIGH
}

function findNote(score: Score, id: string): { note: Note; measure: number } | null {
  for (const m of score.measures) {
    const note = m.notes.find((n) => n.id === id)
    if (note) return { note, measure: m.n }
  }
  return null
}

/** The last voice-1 note on this staff that starts before the cursor, searching back. */
function referencePitch(score: Score, cursor: Cursor): string {
  for (let n = cursor.measure; n >= 1; n--) {
    const notes = score.measures[n - 1].notes.filter(
      (x) => x.staff === cursor.staff && x.voice === 1 && (n < cursor.measure || x.start < cursor.tick),
    )
    if (notes.length) {
      const latest = Math.max(...notes.map((x) => x.start))
      const chord = notes.filter((x) => x.start === latest)
      // Lowest note in the bass, highest in the treble: follows the outer voice.
      chord.sort((a, b) => toMidi(a.pitch) - toMidi(b.pitch))
      return (cursor.staff === 'LH' ? chord[0] : chord[chord.length - 1]).pitch
    }
  }
  return DEFAULT_REFERENCE[cursor.staff]
}

/** The pitch with this letter closest to the reference, spelled in the key. */
export function nearestPitch(step: string, reference: string, fifths: number): string {
  const ref = diatonicIndex(reference)
  const stepIndex = STEPS.indexOf(step)
  const octave = Math.floor(ref / 7)
  const candidates = [octave - 1, octave, octave + 1]
    .map((o) => o * 7 + stepIndex)
    .sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref))
    .map((i) => fromDiatonic(i, fifths))
  return candidates.find(inRange) ?? candidates[0]
}

/** Ops that clear [from, to) on a staff so a new note can go there (overwrite mode). */
function clearRange(
  score: Score, measure: number, staff: Staff, from: number, to: number, keep?: string,
): Op[] {
  const ops: Op[] = []
  for (const note of score.measures[measure - 1].notes) {
    if (note.staff !== staff || note.voice !== 1 || note.id === keep) continue
    const end = note.start + note.dur
    if (note.start >= from && note.start < to) {
      ops.push({ op: 'remove_note', id: note.id })
    } else if (note.start < from && end > from) {
      ops.push({ op: 'update_note', id: note.id, set: { dur: from - note.start } })
    }
  }
  return ops
}

/** Advance past [tick, tick+dur), moving to the next measure (and adding one) at the barline. */
function advance(score: Score, cursor: Cursor, end: number): { ops: Op[]; cursor: Cursor } {
  if (end < measureTicks(score.meta)) return { ops: [], cursor: { ...cursor, tick: end } }
  const next = cursor.measure + 1
  const ops: Op[] =
    next > score.measures.length ? [{ op: 'insert_measures', at: next, count: 1 }] : []
  return { ops, cursor: { ...cursor, measure: next, tick: 0 } }
}

/** Type a note name: write it at the cursor with the current duration, then move on. */
export function writeNote(
  score: Score, cursor: Cursor, step: string, dur: number, newId: string,
): EntryResult {
  const length = measureTicks(score.meta)
  const d = Math.min(dur, length - cursor.tick)
  const fifths = keyFifths(score.meta.key, score.meta.mode)
  const pitch = nearestPitch(step, referencePitch(score, cursor), fifths)
  const note: Note = {
    id: newId, staff: cursor.staff, voice: 1, pitch, start: cursor.tick, dur: d, tie: false,
  }
  const next = advance(score, cursor, cursor.tick + d)
  return {
    ops: [
      ...clearRange(score, cursor.measure, cursor.staff, cursor.tick, cursor.tick + d),
      { op: 'add_note', measure: cursor.measure, note },
      ...next.ops,
    ],
    cursor: next.cursor,
    select: newId,
  }
}

/** Shift+note name: stack that letter above the selected note, as a chord tone. */
export function addChordTone(
  score: Score, cursor: Cursor, selectedId: string, step: string, newId: string,
): EntryResult | null {
  const found = findNote(score, selectedId)
  if (!found) return null
  const { note, measure } = found
  const base = diatonicIndex(note.pitch)
  const up = (STEPS.indexOf(step) - (base % 7) + 7) % 7 || 7
  const pitch = fromDiatonic(base + up, keyFifths(score.meta.key, score.meta.mode))
  if (!inRange(pitch)) return null
  return {
    ops: [{ op: 'add_note', measure, note: { ...note, id: newId, pitch } }],
    cursor,
    select: newId,
  }
}

export type Transposition = 'step' | 'octave' | 'semitone'

/** Arrow keys: move a note by a scale step, an octave, or a semitone. */
export function transpose(
  score: Score, id: string, by: Transposition, dir: 1 | -1,
): Op[] {
  const found = findNote(score, id)
  if (!found) return []
  const current = found.note.pitch
  let pitch: string
  if (by === 'step') {
    pitch = fromDiatonic(diatonicIndex(current) + dir, keyFifths(score.meta.key, score.meta.mode))
  } else if (by === 'octave') {
    const p = parsePitch(current)
    if (p.octave + dir < 0 || p.octave + dir > 8) return []
    pitch = formatPitch({ ...p, octave: p.octave + dir })
  } else {
    const p = parsePitch(current)
    if (Math.abs(p.alter + dir) > 2) return []
    pitch = formatPitch({ ...p, alter: p.alter + dir })
  }
  return inRange(pitch) ? [{ op: 'update_note', id, set: { pitch } }] : []
}

/** Change the selected note's duration, overwriting whatever it now runs into. */
export function setNoteDuration(score: Score, id: string, dur: number): Op[] {
  const found = findNote(score, id)
  if (!found) return []
  const { note, measure } = found
  const d = Math.min(dur, measureTicks(score.meta) - note.start)
  // The whole chord changes together so it stays one chord.
  const chord = score.measures[measure - 1].notes.filter(
    (n) => n.staff === note.staff && n.voice === 1 && n.start === note.start,
  )
  const keep = new Set(chord.map((n) => n.id))
  const cleared = clearRange(score, measure, note.staff, note.start + 1, note.start + d)
    .filter((op) => !('id' in op && keep.has(op.id)))
  return [...cleared, ...chord.map((n): Op => ({ op: 'update_note', id: n.id, set: { dur: d } }))]
}

export function deleteNote(score: Score, id: string): EntryResult | null {
  const found = findNote(score, id)
  if (!found) return null
  return {
    ops: [{ op: 'remove_note', id }],
    cursor: { measure: found.measure, staff: found.note.staff, tick: found.note.start },
    select: null,
  }
}

function eventIndex(events: StaffEvent[], tick: number): number {
  const i = events.findIndex((e) => tick >= e.start && tick < e.start + e.dur)
  return i === -1 ? events.length - 1 : i
}

function landOn(event: StaffEvent, staff: Staff, measure: number) {
  const notes = event.notes
  const pick = staff === 'LH' ? notes[0] : notes[notes.length - 1]
  return { cursor: { measure, staff, tick: event.start }, select: pick?.id ?? null }
}

/** Left/right arrows: step through chords and rests on the cursor's staff. */
export function moveCursor(score: Score, cursor: Cursor, dir: 1 | -1) {
  const events = staffEvents(score.measures[cursor.measure - 1], cursor.staff, score.meta)
  const i = eventIndex(events, cursor.tick)
  if (dir === -1 && cursor.tick > events[i].start) return landOn(events[i], cursor.staff, cursor.measure)
  const j = i + dir
  if (j >= 0 && j < events.length) return landOn(events[j], cursor.staff, cursor.measure)
  const m = cursor.measure + dir
  if (m < 1 || m > score.measures.length) return landOn(events[i], cursor.staff, cursor.measure)
  const other = staffEvents(score.measures[m - 1], cursor.staff, score.meta)
  return landOn(dir === 1 ? other[0] : other[other.length - 1], cursor.staff, m)
}

/** Tab: jump to the other hand at the same point in the bar. */
export function switchStaff(score: Score, cursor: Cursor) {
  const staff: Staff = cursor.staff === 'RH' ? 'LH' : 'RH'
  const events = staffEvents(score.measures[cursor.measure - 1], staff, score.meta)
  return landOn(events[eventIndex(events, cursor.tick)], staff, cursor.measure)
}

/** Clicking a note: select it and put the cursor on it. */
export function cursorForNote(score: Score, id: string): Cursor | null {
  const found = findNote(score, id)
  return found ? { measure: found.measure, staff: found.note.staff, tick: found.note.start } : null
}
