// Editor state and the save loop.
//
// Every change goes through apply(): it updates the score locally right away, records the ops
// that undo it, and queues the ops for the server. Queued ops are sent a moment after typing
// stops, one request at a time, each against the version the server last confirmed. Undo and
// redo are ordinary edits too, so they save the same way.

import { create } from 'zustand'
import sketch from '../../../fixtures/autumn-sketch.json'
import { api, ApiError, type HistoryEntry, type ScoreDetail, type ScoreSummary } from '../api/client'
import type { Cursor } from '../input/noteEntry'
import type { View } from '../render/engrave'
import { applyOpsWithInverse } from '../score/applyOps'
import type { Op, Score } from '../score/types'

const SAVE_DELAY = 800
const RETRY_DELAY = 3000
const HISTORY_LIMIT = 200
const START: Cursor = { measure: 1, staff: 'RH', tick: 0 }

/** Note values offered by the toolbar and the 3-7 keys, in ticks at ppq 480. */
export const DURATIONS = [
  { key: '3', ticks: 120, label: 'Sixteenth' },
  { key: '4', ticks: 240, label: 'Eighth' },
  { key: '5', ticks: 480, label: 'Quarter' },
  { key: '6', ticks: 960, label: 'Half' },
  { key: '7', ticks: 1920, label: 'Whole' },
] as const

type Edit = { ops: Op[]; inverse: Op[] }
type Next = { cursor?: Cursor; selected?: string | null }

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'offline'

export type Preview = { number: number; message: string; score: Score }

/** A suggested next bar (Tab autocomplete), shown faded until accepted. */
export type Suggestion = {
  base: number
  measure: number
  staff: 'RH' | 'LH'
  ops: Op[]
  /** The score with the suggestion applied, for display. */
  score: Score
  ids: Set<string>
}

/** Measures selected with Shift+click or Shift+arrows, inclusive. */
export type MeasureRange = { start: number; end: number }

type EditorState = {
  scores: ScoreSummary[]
  scoreId: string | null
  score: Score | null
  /** The server version the local score is based on, before `pending` ops. */
  head: number
  pending: Op[]
  saving: boolean
  offline: boolean
  notice: string | null
  /** Set when the workspace couldn't be loaded at all (e.g. the API is down). */
  loadError: string | null
  past: Edit[]
  future: Edit[]
  history: HistoryEntry[]
  /** An older version being viewed read-only from the History panel. */
  preview: Preview | null
  cursor: Cursor
  selected: string | null
  range: MeasureRange | null
  /** Whether the agent chat panel is showing. */
  chatOpen: boolean
  suggestion: Suggestion | null
  /** Tab autocomplete on/off (each suggestion is a model call). */
  suggestOn: boolean
  /** Full grand staff, or a lead sheet (melody and chord symbols). */
  view: View
  /** The editor, or the new-score screen (blank, from chords, import). */
  screen: 'editor' | 'new'
  /** Base note value for entry, in ticks; `dotted` lengthens it by half. */
  duration: number
  dotted: boolean

  init: () => Promise<void>
  open: (id: string, options?: { replaceUrl?: boolean }) => Promise<void>
  createScore: (score?: Score) => Promise<void>
  /** Show the new-score screen. */
  startNew: () => Promise<void>
  deleteScore: (id: string) => Promise<void>
  apply: (ops: Op[], next?: Next) => void
  undo: () => void
  redo: () => void
  flush: () => Promise<void>
  showRevision: (number: number | null) => Promise<void>
  restore: (number: number) => Promise<void>
  moveTo: (next: Next) => void
  /** Extend the measure range from the cursor's measure to `measure`; null clears it. */
  selectTo: (measure: number | null) => void
  toggleChat: () => void
  setSuggestion: (suggestion: Suggestion | null) => void
  acceptSuggestion: () => void
  toggleSuggest: () => void
  setView: (view: View) => void
  /** Install an agent edit the server accepted, and make it undoable. */
  applyAccepted: (head: number, score: Score, ops: Op[]) => void
  setDuration: (ticks: number) => void
  toggleDot: () => void
  dismissNotice: () => void
}

export function entryTicks(state: Pick<EditorState, 'duration' | 'dotted'>): number {
  return state.dotted ? state.duration * 1.5 : state.duration
}

export function saveStatus(state: Pick<EditorState, 'saving' | 'offline' | 'pending'>): SaveStatus {
  if (state.offline) return 'offline'
  if (state.saving) return 'saving'
  return state.pending.length ? 'unsaved' : 'saved'
}

export function newNoteId(): string {
  return `n_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
}

const CHAT_KEY = 'chordcraft.chatOpen'
const SUGGEST_KEY = 'chordcraft.suggestOn'

// Per-browser preferences. Storage can be unavailable (private mode); defaults then apply.
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Not persisted; the setting still applies for this session.
  }
}

function readChatOpen(): boolean {
  return readFlag(CHAT_KEY, true)
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSave(delay = SAVE_DELAY) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void useEditor.getState().flush(), delay)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Send anything queued and wait for it, e.g. before switching scores or asking the agent. */
export async function settle() {
  clearTimeout(saveTimer)
  for (let i = 0; i < 50; i++) {
    const s = useEditor.getState()
    if (s.offline || (!s.saving && !s.pending.length)) return
    if (s.saving) await sleep(100)
    else await s.flush()
  }
}

function scoreUrl(id: string) {
  return `/scores/${id}`
}

const NEW_URL = '/new'

function idFromUrl(): string | null {
  return /^\/scores\/([0-9a-f-]{36})$/.exec(window.location.pathname)?.[1] ?? null
}

async function refreshSidebar(id: string) {
  const [scores, history] = await Promise.all([api.listScores(), api.history(id)])
  if (useEditor.getState().scoreId === id) useEditor.setState({ scores, history })
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Apply ops locally and queue them for the server. */
  function commit(ops: Op[]): Edit | null {
    const { score, pending } = get()
    if (!score || !ops.length) return null
    const { score: updated, inverse } = applyOpsWithInverse(score, ops)
    set({ score: updated, pending: [...pending, ...ops] })
    scheduleSave()
    return { ops, inverse }
  }

  function load(detail: ScoreDetail) {
    set({
      scoreId: detail.id,
      score: detail.score,
      head: detail.head,
      pending: [],
      saving: false,
      offline: false,
      past: [],
      future: [],
      preview: null,
      selected: null,
      range: null,
      cursor: START,
    })
  }

  return {
    scores: [],
    scoreId: null,
    score: null,
    head: 0,
    pending: [],
    saving: false,
    offline: false,
    notice: null,
    loadError: null,
    past: [],
    future: [],
    history: [],
    preview: null,
    cursor: START,
    selected: null,
    range: null,
    chatOpen: readChatOpen(),
    suggestion: null,
    suggestOn: readFlag(SUGGEST_KEY, true),
    view: 'score',
    screen: 'editor',
    duration: 480,
    dotted: false,

    init: async () => {
      set({ loadError: null })
      try {
        const scores = await api.listScores()
        set({ scores })
        if (window.location.pathname === NEW_URL && scores.length) return set({ screen: 'new' })
        const wanted = idFromUrl()
        if (wanted && scores.some((s) => s.id === wanted)) return await get().open(wanted)
        if (scores.length) return await get().open(scores[0].id, { replaceUrl: true })
        // First run: start with the example score so there's something to play with. The
        // server creates it only once, even when several tabs open at the same moment.
        const starter = await api.starterScore(sketch as Score)
        return await get().open(starter.id, { replaceUrl: true })
      } catch {
        set({ loadError: "Couldn't reach the ChordCraft server." })
      }
    },

    open: async (id, options = {}) => {
      await settle()
      const [detail, history, scores] = await Promise.all([
        api.getScore(id),
        api.history(id),
        api.listScores(),
      ])
      load(detail)
      set({ history, scores, screen: 'editor' })
      const url = scoreUrl(id)
      if (window.location.pathname !== url) {
        if (options.replaceUrl) window.history.replaceState(null, '', url)
        else window.history.pushState(null, '', url)
      }
    },

    createScore: async (score) => {
      const detail = await api.createScore(score)
      await get().open(detail.id)
    },

    startNew: async () => {
      await settle()
      set({ screen: 'new', preview: null })
      if (window.location.pathname !== NEW_URL) window.history.pushState(null, '', NEW_URL)
    },

    deleteScore: async (id) => {
      await api.deleteScore(id)
      const scores = await api.listScores()
      set({ scores })
      if (get().scoreId !== id) return
      if (scores.length) await get().open(scores[0].id, { replaceUrl: true })
      else await get().createScore()
    },

    apply: (ops, next = {}) => {
      const edit = commit(ops)
      if (!edit) return
      set((s) => ({ past: [...s.past, edit].slice(-HISTORY_LIMIT), future: [], ...next }))
    },

    undo: () => {
      const edit = get().past.at(-1)
      if (!edit) return
      commit(edit.inverse)
      set((s) => ({ past: s.past.slice(0, -1), future: [edit, ...s.future], selected: null }))
      clampCursor()
    },

    redo: () => {
      const edit = get().future[0]
      if (!edit) return
      commit(edit.ops)
      set((s) => ({ past: [...s.past, edit], future: s.future.slice(1), selected: null }))
      clampCursor()
    },

    flush: async () => {
      const { saving, pending, scoreId, head } = get()
      if (saving || !pending.length || !scoreId) return
      clearTimeout(saveTimer)
      set({ saving: true, pending: [] })
      try {
        const saved = await api.saveEdit(scoreId, head, pending)
        set({ head: saved.head, saving: false, offline: false })
        void refreshSidebar(scoreId)
        if (get().pending.length) scheduleSave(0)
      } catch (err) {
        if (err instanceof ApiError && (err.status === 409 || err.status === 422)) {
          // The server's copy has moved on or disagrees: reload it rather than guess. Drop the
          // queue first so reloading doesn't try to send it against the stale version again.
          set({ saving: false, pending: [] })
          await get().open(scoreId, { replaceUrl: true })
          set({
            notice:
              err.status === 409
                ? 'This score changed somewhere else, so the latest version was loaded.'
                : 'An edit could not be saved, so the last saved version was loaded.',
          })
        } else {
          set((s) => ({ saving: false, offline: true, pending: [...pending, ...s.pending] }))
          setTimeout(() => {
            set({ offline: false })
            void get().flush()
          }, RETRY_DELAY)
        }
      }
    },

    showRevision: async (number) => {
      const { scoreId, head, pending } = get()
      if (number === null || !scoreId || (number === head && !pending.length)) {
        set({ preview: null })
        return
      }
      const rev = await api.revision(scoreId, number)
      set({ preview: { number: rev.number, message: rev.message, score: rev.score } })
    },

    restore: async (number) => {
      await settle()
      const { scoreId, head } = get()
      if (!scoreId) return
      load(await api.restore(scoreId, head, number))
      await refreshSidebar(scoreId)
    },

    moveTo: (next) => set(next),

    setView: (view) => {
      // A lead sheet shows only the melody, so the cursor stays on the right hand.
      set((s) => ({
        view,
        cursor: view === 'lead' ? { ...s.cursor, staff: 'RH' } : s.cursor,
        selected: view === 'lead' ? null : s.selected,
      }))
    },

    setSuggestion: (suggestion) => set({ suggestion }),

    acceptSuggestion: () => {
      const { suggestion, score, cursor } = get()
      if (!suggestion || !score) return
      // Tab moves on to the next bar, where the next suggestion can appear.
      const next = Math.min(score.measures.length, suggestion.measure + 1)
      get().apply(suggestion.ops, {
        cursor: { ...cursor, measure: next, staff: suggestion.staff, tick: 0 },
        selected: null,
      })
      set({ suggestion: null })
    },

    toggleSuggest: () => {
      const suggestOn = !get().suggestOn
      set({ suggestOn, suggestion: null })
      writeFlag(SUGGEST_KEY, suggestOn)
    },

    toggleChat: () => {
      const chatOpen = !get().chatOpen
      set({ chatOpen })
      writeFlag(CHAT_KEY, chatOpen)
    },

    selectTo: (measure) => {
      if (measure === null) return set({ range: null })
      const { cursor, range } = get()
      const anchor = range ? (cursor.measure === range.end ? range.start : range.end) : cursor.measure
      set({
        range: { start: Math.min(anchor, measure), end: Math.max(anchor, measure) },
        cursor: { ...cursor, measure, tick: 0 },
        selected: null,
      })
    },

    applyAccepted: (head, score, ops) => {
      const { score: before, scoreId } = get()
      if (!before || !scoreId) return
      // The server applied the ops; computing them locally gives the inverse for undo.
      const { inverse } = applyOpsWithInverse(before, ops)
      set((s) => ({
        score,
        head,
        past: [...s.past, { ops, inverse }].slice(-HISTORY_LIMIT),
        future: [],
        range: null,
        selected: null,
      }))
      clampCursor()
      void refreshSidebar(scoreId)
    },
    setDuration: (ticks) => set({ duration: ticks, dotted: false }),
    toggleDot: () => set((s) => ({ dotted: !s.dotted && s.duration > 120 })),
    dismissNotice: () => set({ notice: null }),
  }
})

/** Undo can remove measures; keep the cursor inside the score. */
function clampCursor() {
  const { score, cursor } = useEditor.getState()
  if (score && cursor.measure > score.measures.length) {
    useEditor.setState({ cursor: { ...cursor, measure: score.measures.length, tick: 0 } })
  }
}

// Browser back/forward between scores.
window.addEventListener('popstate', () => {
  if (window.location.pathname === NEW_URL) return useEditor.setState({ screen: 'new' })
  const id = idFromUrl()
  const { scoreId, screen } = useEditor.getState()
  if (id && (id !== scoreId || screen !== 'editor')) void useEditor.getState().open(id)
})

// Don't lose queued edits when the tab closes.
window.addEventListener('beforeunload', (e) => {
  const s = useEditor.getState()
  if (s.pending.length || s.saving) e.preventDefault()
})
