// The score model. Mirrors api/app/score/model.py; see docs/PLAN.md ("Score model").

export type Staff = 'RH' | 'LH'
export type Mode = 'major' | 'minor'

export type Note = {
  id: string
  staff: Staff
  voice: number
  /** Spelled pitch name, e.g. "F#3" or "Bb4". */
  pitch: string
  /** Offset from the start of the measure, in ticks. */
  start: number
  /** Length in ticks (meta.ppq per quarter note). */
  dur: number
  tie: boolean
}

export type Measure = {
  n: number
  chord: string | null
  section: string | null
  notes: Note[]
}

export type Meta = {
  title: string
  key: string
  mode: Mode
  time: [number, number]
  tempo: number
  ppq: number
}

export type Score = {
  meta: Meta
  measures: Measure[]
}

export type NotePatch = Partial<Pick<Note, 'staff' | 'voice' | 'pitch' | 'start' | 'dur' | 'tie'>> & {
  measure?: number
}

export type MetaPatch = Partial<Pick<Meta, 'title' | 'key' | 'mode' | 'time' | 'tempo'>>

export type Op =
  | { op: 'add_note'; measure: number; note: Note }
  | { op: 'remove_note'; id: string }
  | { op: 'update_note'; id: string; set: NotePatch }
  | { op: 'set_chord'; measure: number; chord: string | null }
  | { op: 'set_section'; measure: number; section: string | null }
  | { op: 'insert_measures'; at: number; count?: number }
  | { op: 'delete_measures'; at: number; count?: number }
  | { op: 'set_meta'; set: MetaPatch }

export const STAFF_ORDER: Record<Staff, number> = { RH: 0, LH: 1 }

export function measureTicks(meta: Meta): number {
  const [beats, unit] = meta.time
  return Math.floor((beats * meta.ppq * 4) / unit)
}
