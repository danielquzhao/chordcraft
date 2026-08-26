// Tab autocomplete: when the cursor waits at the start of an empty bar, and that hand has music
// in the bar before, ask the server for a suggested continuation and show it faded.

import { useEffect } from 'react'
import { agentLocksScore, useAgent } from '../agent/store'
import { api } from '../api/client'
import { applyOps } from '../score/applyOps'
import type { Score, Staff } from '../score/types'
import { useEditor } from './store'

const DELAY_MS = 900

function hasNotes(score: Score, measure: number, staff: Staff): boolean {
  return score.measures[measure - 1]?.notes.some((n) => n.staff === staff) ?? false
}

export function useAutocomplete() {
  const score = useEditor((s) => s.score)
  const scoreId = useEditor((s) => s.scoreId)
  const head = useEditor((s) => s.head)
  const cursor = useEditor((s) => s.cursor)
  const settled = useEditor((s) => s.pending.length === 0 && !s.saving)
  const on = useEditor((s) => s.suggestOn)
  const range = useEditor((s) => s.range)
  const preview = useEditor((s) => s.preview)
  const view = useEditor((s) => s.view)
  const locked = useAgent((s) => agentLocksScore(s.phase))

  useEffect(() => {
    const { setSuggestion } = useEditor.getState()
    setSuggestion(null)
    const { measure, staff, tick } = cursor
    const eligible =
      on && score && scoreId && settled && !range && !preview && !locked && tick === 0 &&
      measure > 1 && (view === 'score' || staff === 'RH') &&
      !hasNotes(score, measure, staff) && hasNotes(score, measure - 1, staff)
    if (!eligible) return

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const result = await api.suggest(scoreId, head, measure, staff, controller.signal)
        const now = useEditor.getState()
        // Only show it if nothing moved while we waited.
        if (!result.ops.length || now.head !== head || now.score !== score || now.cursor !== cursor) return
        const ids = new Set(result.ops.flatMap((op) => (op.op === 'add_note' ? [op.note.id] : [])))
        setSuggestion({ base: head, measure, staff, ops: result.ops, score: applyOps(score, result.ops), ids })
      } catch {
        // Aborted, offline, or no suggestion: autocomplete stays quiet.
      }
    }, DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [score, scoreId, head, cursor, settled, on, range, preview, locked, view])
}
