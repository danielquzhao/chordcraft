// The inline agent edit (⌘K): compose a request, follow the job's progress, then review the
// proposal as a ghost-note diff and accept or reject it.

import { create } from 'zustand'
import {
  api,
  ApiError,
  type AgentStep,
  type EditEvent,
  type Proposal,
  type Selection,
} from '../api/client'
import { settle, useEditor } from '../editor/store'
import { diffScores, type ScoreDiff } from '../score/diff'

export type Phase = 'idle' | 'composing' | 'running' | 'ready' | 'failed'
export type Hands = 'both' | 'RH' | 'LH'

type AgentState = {
  phase: Phase
  instruction: string
  hands: Hands
  /** The measures and hands the running or proposed edit covers. */
  selection: Selection | null
  jobId: string | null
  steps: AgentStep[]
  proposal: Proposal | null
  diff: ScoreDiff | null
  error: string | null
  /** An accept/reject request is in flight. */
  busy: boolean

  open: () => void
  close: () => void
  setInstruction: (text: string) => void
  setHands: (hands: Hands) => void
  submit: () => Promise<void>
  accept: () => Promise<void>
  reject: () => Promise<void>
}

let source: EventSource | null = null

function stopFollowing() {
  source?.close()
  source = null
}

/** The selection a new request applies to: the measure range, or the cursor's measure. */
export function currentSelection(hands: Hands): Selection {
  const { range, cursor } = useEditor.getState()
  return {
    start: range?.start ?? cursor.measure,
    end: range?.end ?? cursor.measure,
    staves: hands === 'both' ? ['RH', 'LH'] : [hands],
  }
}

const IDLE = {
  phase: 'idle' as Phase,
  selection: null,
  jobId: null,
  steps: [],
  proposal: null,
  diff: null,
  error: null,
  busy: false,
}

export const useAgent = create<AgentState>()((set, get) => {
  function fail(error: string) {
    stopFollowing()
    set({ phase: 'failed', error, busy: false })
  }

  async function loadResult(jobId: string) {
    const job = await api.getEdit(jobId)
    const score = useEditor.getState().score
    if (get().jobId !== jobId) return
    if (job.status === 'ready' && job.proposal && score) {
      set({
        phase: 'ready',
        proposal: job.proposal,
        diff: diffScores(score, job.proposal.score),
        steps: job.proposal.steps,
      })
    } else {
      fail(job.error ?? 'The agent could not finish this edit.')
    }
  }

  function follow(jobId: string) {
    stopFollowing()
    source = new EventSource(api.editEventsUrl(jobId))
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as EditEvent
      if (event.type === 'step') {
        set((s) => ({ steps: [...s.steps, { name: event.name, detail: event.detail, ok: event.ok }] }))
      } else if (event.type === 'done') {
        stopFollowing()
        void loadResult(jobId).catch(() => fail('Could not load the proposed edit.'))
      }
    }
    // EventSource reconnects by itself (the server replays missed steps); only give up if
    // the browser closed the stream for good.
    source.onerror = () => {
      if (source?.readyState === EventSource.CLOSED) fail('Lost the connection to the agent.')
    }
  }

  return {
    ...IDLE,
    instruction: '',
    hands: 'both',

    open: () => {
      const { phase } = get()
      if (phase === 'idle' || phase === 'failed') set({ ...IDLE, phase: 'composing' })
    },

    close: () => {
      if (get().phase === 'composing' || get().phase === 'failed') set({ ...IDLE })
    },

    setInstruction: (instruction) => set({ instruction }),
    setHands: (hands) => set({ hands }),

    submit: async () => {
      const instruction = get().instruction.trim()
      const { scoreId } = useEditor.getState()
      if (!instruction || !scoreId || get().phase !== 'composing') return
      const selection = currentSelection(get().hands)
      set({ phase: 'running', selection, steps: [], error: null })
      try {
        // The agent must see every edit made so far.
        await settle()
        const job = await api.createEdit(scoreId, useEditor.getState().head, instruction, selection)
        set({ jobId: job.id })
        follow(job.id)
      } catch (err) {
        fail(
          err instanceof ApiError && err.status === 409
            ? 'The score changed while sending the request. Try again.'
            : "Couldn't start the edit. Check that the API and worker are running.",
        )
      }
    },

    accept: async () => {
      const { jobId, phase, busy } = get()
      if (!jobId || phase !== 'ready' || busy) return
      set({ busy: true })
      try {
        const result = await api.acceptEdit(jobId)
        useEditor.getState().applyAccepted(result.head, result.score, result.ops)
        set({ ...IDLE, instruction: '' })
      } catch (err) {
        fail(
          err instanceof ApiError && err.status === 409
            ? 'The score changed in the same place since this edit was made, so it can’t be applied. Try again.'
            : "Couldn't apply the edit.",
        )
      }
    },

    reject: async () => {
      const { jobId, phase } = get()
      stopFollowing()
      set({ ...IDLE })
      if (jobId && (phase === 'running' || phase === 'ready')) {
        await api.rejectEdit(jobId).catch(() => undefined)
      }
    },
  }
})

/** While the agent is working or a proposal is up, the score can't be edited by hand. */
export function agentLocksScore(phase: Phase): boolean {
  return phase === 'running' || phase === 'ready'
}
