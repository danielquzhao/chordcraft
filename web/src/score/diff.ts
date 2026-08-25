// What a proposed edit changes, note by note, for the ghost-note diff view.
// A note that moved or changed pitch/length counts as both removed (old) and added (new).

import type { Note, Score } from './types'

export type ScoreDiff = {
  /** Ids of notes in `after` that are new or changed: drawn in blue. */
  added: Set<string>
  /** Per measure number, notes from `before` that are gone or changed: drawn as ghosts. */
  removed: Map<number, Note[]>
  removedCount: number
}

function sameNote(a: Note, b: Note): boolean {
  return (
    a.staff === b.staff &&
    a.voice === b.voice &&
    a.pitch === b.pitch &&
    a.start === b.start &&
    a.dur === b.dur
  )
}

function index(score: Score): Map<string, { measure: number; note: Note }> {
  const map = new Map<string, { measure: number; note: Note }>()
  for (const m of score.measures) for (const note of m.notes) map.set(note.id, { measure: m.n, note })
  return map
}

export function diffScores(before: Score, after: Score): ScoreDiff {
  const old = index(before)
  const now = index(after)
  const added = new Set<string>()
  const removed = new Map<number, Note[]>()
  let removedCount = 0
  const remove = (measure: number, note: Note) => {
    removed.set(measure, [...(removed.get(measure) ?? []), note])
    removedCount++
  }

  for (const [id, { measure, note }] of now) {
    const prev = old.get(id)
    if (!prev) {
      added.add(id)
    } else if (prev.measure !== measure || !sameNote(prev.note, note)) {
      added.add(id)
      remove(prev.measure, prev.note)
    }
  }
  for (const [id, { measure, note }] of old) {
    if (!now.has(id)) remove(measure, note)
  }
  return { added, removed, removedCount }
}
