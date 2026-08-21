// Editor state. Every change to the score goes through apply(), which runs applyOps and records
// undo history; M2 will also send the same ops to the server.

import { create } from 'zustand'
import sketch from '../../../fixtures/autumn-sketch.json'
import type { Cursor } from '../input/noteEntry'
import { applyOps } from '../score/applyOps'
import type { Op, Score } from '../score/types'

const HISTORY_LIMIT = 200

/** Note values offered by the toolbar and the 3-7 keys, in ticks at ppq 480. */
export const DURATIONS = [
  { key: '3', ticks: 120, label: 'Sixteenth' },
  { key: '4', ticks: 240, label: 'Eighth' },
  { key: '5', ticks: 480, label: 'Quarter' },
  { key: '6', ticks: 960, label: 'Half' },
  { key: '7', ticks: 1920, label: 'Whole' },
] as const

type Next = { cursor?: Cursor; selected?: string | null }

type EditorState = {
  score: Score
  past: Score[]
  future: Score[]
  cursor: Cursor
  selected: string | null
  /** Base note value for entry, in ticks; `dotted` lengthens it by half. */
  duration: number
  dotted: boolean
  apply: (ops: Op[], next?: Next) => void
  undo: () => void
  redo: () => void
  moveTo: (next: Next) => void
  setDuration: (ticks: number) => void
  toggleDot: () => void
}

export function entryTicks(state: Pick<EditorState, 'duration' | 'dotted'>): number {
  return state.dotted ? state.duration * 1.5 : state.duration
}

export function newNoteId(): string {
  return `n_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
}

export const useEditor = create<EditorState>()((set, get) => ({
  score: sketch as Score,
  past: [],
  future: [],
  cursor: { measure: 1, staff: 'RH', tick: 0 },
  selected: null,
  duration: 480,
  dotted: false,

  apply: (ops, next = {}) => {
    if (!ops.length) return
    const { score, past } = get()
    const updated = applyOps(score, ops)
    set({
      score: updated,
      past: [...past, score].slice(-HISTORY_LIMIT),
      future: [],
      ...next,
    })
  },

  undo: () => {
    const { past, score, future } = get()
    const previous = past.at(-1)
    if (!previous) return
    set({ score: previous, past: past.slice(0, -1), future: [score, ...future], selected: null })
    clampCursor()
  },

  redo: () => {
    const { past, score, future } = get()
    const next = future[0]
    if (!next) return
    set({ score: next, past: [...past, score], future: future.slice(1), selected: null })
    clampCursor()
  },

  moveTo: (next) => set(next),
  setDuration: (ticks) => set({ duration: ticks, dotted: false }),
  toggleDot: () => set((s) => ({ dotted: !s.dotted && s.duration > 120 })),
}))

/** Undo can remove measures; keep the cursor inside the score. */
function clampCursor() {
  const { score, cursor } = useEditor.getState()
  if (cursor.measure > score.measures.length) {
    useEditor.setState({ cursor: { ...cursor, measure: score.measures.length, tick: 0 } })
  }
}
