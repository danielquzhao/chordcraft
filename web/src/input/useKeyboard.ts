// Global editor shortcuts. Ignored while typing in a text field.
//
//   A-G            write a note at the cursor        Shift+A-G   add a chord tone above
//   3-7            sixteenth .. whole                .           dotted
//   Up/Down        step in the key                   +Cmd octave, +Alt semitone
//   Left/Right     previous / next chord or rest     Tab         switch hands
//   Backspace      delete note                       Esc         clear selection
//   Cmd+Z          undo                              Cmd+Shift+Z redo
//   Space          play / stop                       Shift+Left/Right  select measures
//   Cmd+K          ask the agent to edit the selection   Cmd+L  show/hide the agent chat
//   Tab            accept a suggested bar (when one is showing)
// While the agent works or a proposal is shown: Cmd+Enter accept, Cmd+Backspace reject,
// Esc cancels a running edit.

import { useEffect } from 'react'
import { agentLocksScore, useAgent } from '../agent/store'
import { DURATIONS, entryTicks, newNoteId, useEditor } from '../editor/store'
import {
  addChordTone,
  deleteNote,
  moveCursor,
  setNoteDuration,
  switchStaff,
  transpose,
  writeNote,
} from './noteEntry'

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

export function useKeyboard(togglePlay: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target)) return
      // Leave Tab, Space and Enter to a focused button so keyboard navigation still works.
      if (e.target instanceof HTMLButtonElement && ['Tab', ' ', 'Enter'].includes(e.key)) return
      const state = useEditor.getState()
      const { score, cursor, selected, apply, moveTo, preview } = state
      const mod = e.metaKey || e.ctrlKey
      const key = e.key
      if (!score) return

      if (mod && key.toLowerCase() === 'l') {
        e.preventDefault()
        state.toggleChat()
        return
      }

      if (mod && key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!preview) useAgent.getState().open()
        return
      }

      // The agent is working, or its proposal is on the score: review it, don't edit by hand.
      const agent = useAgent.getState()
      if (agentLocksScore(agent.phase)) {
        if (mod && key === 'Enter') void agent.accept()
        else if (mod && key === 'Backspace') void agent.reject()
        else if (key === 'Escape' && agent.phase === 'running') void agent.reject()
        else if (key === ' ') togglePlay()
        else return
        e.preventDefault()
        return
      }

      // A suggested bar is showing: Tab takes it, Esc drops it, anything else carries on as
      // usual (and the suggestion clears as soon as the score or cursor changes).
      if (state.suggestion && !mod) {
        if (key === 'Tab' && !e.shiftKey) {
          e.preventDefault()
          state.acceptSuggestion()
          return
        }
        if (key === 'Escape') {
          e.preventDefault()
          state.setSuggestion(null)
          return
        }
      }

      // An old version from History is read-only: only playback and leaving the preview work.
      if (preview) {
        if (key === 'Escape') void state.showRevision(null)
        else if (key === ' ') togglePlay()
        else return
        e.preventDefault()
        return
      }

      const handled = (() => {
        if (mod && key.toLowerCase() === 'z') {
          if (e.shiftKey) state.redo()
          else state.undo()
          return true
        }
        if (mod && key.toLowerCase() === 'y') {
          state.redo()
          return true
        }
        if (mod && !['ArrowUp', 'ArrowDown'].includes(key)) return false

        const letter = key.toUpperCase()
        if (key.length === 1 && 'ABCDEFG'.includes(letter) && !e.altKey) {
          if (e.shiftKey && selected) {
            const r = addChordTone(score, cursor, selected, letter, newNoteId())
            if (r) apply(r.ops, { cursor: r.cursor, selected: r.select })
          } else {
            const r = writeNote(score, cursor, letter, entryTicks(state), newNoteId())
            apply(r.ops, { cursor: r.cursor, selected: r.select })
          }
          return true
        }

        const duration = DURATIONS.find((d) => d.key === key)
        if (duration) {
          state.setDuration(duration.ticks)
          if (selected) apply(setNoteDuration(score, selected, duration.ticks))
          return true
        }
        if (key === '.') {
          state.toggleDot()
          const after = useEditor.getState()
          if (selected && after.score) apply(setNoteDuration(after.score, selected, entryTicks(after)))
          return true
        }

        switch (key) {
          case 'ArrowUp':
          case 'ArrowDown': {
            if (!selected) return false
            const dir = key === 'ArrowUp' ? 1 : -1
            const by = mod ? 'octave' : e.altKey ? 'semitone' : 'step'
            apply(transpose(score, selected, by, dir))
            return true
          }
          case 'ArrowLeft':
          case 'ArrowRight': {
            if (e.shiftKey) {
              const step = key === 'ArrowRight' ? 1 : -1
              const target = Math.min(score.measures.length, Math.max(1, cursor.measure + step))
              state.selectTo(target)
              return true
            }
            state.selectTo(null)
            const r = moveCursor(score, cursor, key === 'ArrowRight' ? 1 : -1)
            moveTo({ cursor: r.cursor, selected: r.select })
            return true
          }
          case 'Tab': {
            if (state.view === 'lead') return false // only the melody is shown
            const r = switchStaff(score, cursor)
            moveTo({ cursor: r.cursor, selected: r.select })
            return true
          }
          case 'Backspace':
          case 'Delete': {
            const r = selected && deleteNote(score, selected)
            if (r) apply(r.ops, { cursor: r.cursor, selected: r.select })
            return true
          }
          case 'Escape':
            moveTo({ selected: null })
            state.selectTo(null)
            return true
          case ' ':
            togglePlay()
            return true
        }
        return false
      })()

      if (handled) e.preventDefault()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])
}
