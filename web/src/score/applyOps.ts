// Mirrors api/app/score/ops.py. Both run the shared cases in fixtures/ops_cases.json.
// Ops are atomic: if any op fails, OpError is thrown and the input score is untouched.

import { isValidPitch, keyFifths, PIANO_HIGH, PIANO_LOW, toMidi } from './pitch'
import { measureTicks, STAFF_ORDER, type Measure, type Note, type Op, type Score } from './types'

const DENOMINATORS = new Set([1, 2, 4, 8, 16])
const MAX_INSERT = 64

export class OpError extends Error {
  index: number
  code: string

  constructor(index: number, code: string, message: string) {
    super(`op ${index}: ${message}`)
    this.index = index
    this.code = code
  }
}

class Fail extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function applyOps(score: Score, ops: Op[]): Score {
  const result = structuredClone(score)
  ops.forEach((op, index) => {
    try {
      apply(result, op)
    } catch (err) {
      if (err instanceof Fail) throw new OpError(index, err.code, err.message)
      throw err
    }
  })
  result.measures.forEach((measure, i) => {
    measure.n = i + 1
    measure.notes.sort(compareNotes)
  })
  return result
}

export function compareNotes(a: Note, b: Note): number {
  return (
    STAFF_ORDER[a.staff] - STAFF_ORDER[b.staff] ||
    a.voice - b.voice ||
    a.start - b.start ||
    toMidi(a.pitch) - toMidi(b.pitch) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

function apply(score: Score, op: Op): void {
  switch (op.op) {
    case 'add_note':
      return addNote(score, op.measure, op.note)
    case 'remove_note': {
      const [m, i] = findNote(score, op.id)
      score.measures[m].notes.splice(i, 1)
      return
    }
    case 'update_note':
      return updateNote(score, op)
    case 'set_chord':
      measure(score, op.measure).chord = op.chord
      return
    case 'set_section':
      measure(score, op.measure).section = op.section
      return
    case 'insert_measures':
      return insertMeasures(score, op.at, op.count ?? 1)
    case 'delete_measures':
      return deleteMeasures(score, op.at, op.count ?? 1)
    case 'set_meta':
      return setMeta(score, op.set)
  }
}

function measure(score: Score, n: number): Measure {
  if (!(n >= 1 && n <= score.measures.length)) {
    throw new Fail('measure_not_found', `measure ${n} does not exist`)
  }
  return score.measures[n - 1]
}

function findNote(score: Score, id: string): [number, number] {
  for (let m = 0; m < score.measures.length; m++) {
    const i = score.measures[m].notes.findIndex((n) => n.id === id)
    if (i !== -1) return [m, i]
  }
  throw new Fail('note_not_found', `note ${id} does not exist`)
}

function checkNote(score: Score, note: Note): void {
  if (!isValidPitch(note.pitch)) throw new Fail('invalid_op', `invalid pitch ${note.pitch}`)
  if (note.start < 0 || note.dur <= 0) throw new Fail('invalid_op', `note ${note.id} has bad timing`)
  const length = measureTicks(score.meta)
  if (note.start + note.dur > length) {
    throw new Fail(
      'out_of_measure',
      `note ${note.id} ends at tick ${note.start + note.dur}, past the measure end (${length})`,
    )
  }
  const midi = toMidi(note.pitch)
  if (midi < PIANO_LOW || midi > PIANO_HIGH) {
    throw new Fail('out_of_range', `note ${note.id} (${note.pitch}) is outside the piano's range`)
  }
}

function addNote(score: Score, n: number, note: Note): void {
  const target = measure(score, n)
  if (score.measures.some((m) => m.notes.some((x) => x.id === note.id))) {
    throw new Fail('duplicate_id', `note ${note.id} already exists`)
  }
  // Same defaults as the Pydantic model, for ops that omit optional fields.
  const copy: Note = { ...note, voice: note.voice ?? 1, tie: note.tie ?? false }
  checkNote(score, copy)
  target.notes.push(copy)
}

function updateNote(score: Score, op: Extract<Op, { op: 'update_note' }>): void {
  const [m, i] = findNote(score, op.id)
  const { measure: target = m + 1, ...changes } = op.set
  const note: Note = { ...score.measures[m].notes[i] }
  for (const [k, v] of Object.entries(changes)) {
    if (v !== undefined && v !== null) Object.assign(note, { [k]: v })
  }
  const destination = measure(score, target)
  checkNote(score, note)
  score.measures[m].notes.splice(i, 1)
  destination.notes.push(note)
}

function insertMeasures(score: Score, at: number, count: number): void {
  if (count < 1 || count > MAX_INSERT) throw new Fail('invalid_op', `bad measure count ${count}`)
  if (at < 1 || at > score.measures.length + 1) {
    throw new Fail(
      'measure_not_found',
      `cannot insert at ${at}; score has ${score.measures.length}`,
    )
  }
  const fresh = Array.from({ length: count }, (_, k) => ({
    n: at + k,
    chord: null,
    section: null,
    notes: [],
  }))
  score.measures.splice(at - 1, 0, ...fresh)
}

function deleteMeasures(score: Score, at: number, count: number): void {
  const last = at + count - 1
  if (at < 1 || count < 1 || last > score.measures.length) {
    throw new Fail('measure_not_found', `measures ${at}-${last} do not all exist`)
  }
  if (count >= score.measures.length) {
    throw new Fail('last_measure', 'a score needs at least one measure')
  }
  score.measures.splice(at - 1, count)
}

function setMeta(score: Score, patch: Extract<Op, { op: 'set_meta' }>['set']): void {
  const meta = { ...score.meta }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) Object.assign(meta, { [k]: v })
  }
  try {
    keyFifths(meta.key, meta.mode)
  } catch (err) {
    throw new Fail('invalid_meta', (err as Error).message)
  }
  const [beats, unit] = meta.time
  if (!(beats >= 1 && beats <= 32) || !DENOMINATORS.has(unit)) {
    throw new Fail('invalid_meta', `unsupported time signature ${beats}/${unit}`)
  }
  if (!(meta.tempo >= 20 && meta.tempo <= 400)) {
    throw new Fail('invalid_meta', `tempo ${meta.tempo} is out of range`)
  }
  const length = measureTicks(meta)
  for (const m of score.measures) {
    if (m.notes.some((note) => note.start + note.dur > length)) {
      throw new Fail('notes_overflow', `measure ${m.n} has notes past the end of a ${beats}/${unit} bar`)
    }
  }
  score.meta = meta
}
