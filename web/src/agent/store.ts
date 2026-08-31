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
/** Where the request came from: the ⌘K bar or the chat panel. */
export type Source = 'bar' | 'chat'
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
  source: Source | null
  /** Bumped whenever a job settles or is accepted/rejected, so the chat reloads. */
  version: number

  open: () => void
  close: () => void
  setInstruction: (text: string) => void
  setHands: (hands: Hands) => void
  submit: () => Promise<void>
  /** Start an edit with a given instruction and selection (e.g. right after "From chords"). */
  request: (instruction: string, selection: Selection) => Promise<void>
  accept: () => Promise<void>
  reject: () => Promise<void>
  /** Send a chat message; the agent answers it or proposes an edit. */
  submitChat: (content: string, selection: Selection) => Promise<boolean>
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

/** The server's own message when today's agent edits are used up, else null. */
function dailyLimit(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null
  const detail = err.detail as { message?: string } | null
  return detail?.message ?? "You've used today's agent edits. Try again tomorrow."
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
  source: null,
}

export const useAgent = create<AgentState>()((set, get) => {
  function fail(error: string) {
    stopFollowing()
    set((s) => ({ phase: 'failed', error, busy: false, version: s.version + 1 }))
  }

  function settled(next: Partial<AgentState>) {
    set((s) => ({ ...next, version: s.version + 1 }))
  }

  async function loadResult(jobId: string) {
    const job = await api.getEdit(jobId)
    const score = useEditor.getState().score
    if (get().jobId !== jobId) return
    if (job.status === 'ready' && job.proposal && score && job.proposal.ops.length === 0) {
      // An answer, or a request the agent declined. In chat the reply is the result.
      if (get().source === 'chat') settled({ ...IDLE })
      else fail(job.proposal.summary || 'The agent made no changes.')
    } else if (job.status === 'ready' && job.proposal && score) {
      settled({
        phase: 'ready',
        proposal: job.proposal,
        diff: diffScores(score, job.proposal.score),
        steps: job.proposal.steps,
      })
    } else {
      fail(job.error ?? 'The agent could not finish this edit.')
    }
  }

  async function follow(jobId: string) {
    stopFollowing()
    const url = await api.editEventsUrl(jobId)
    if (get().jobId !== jobId) return
    source = new EventSource(url)
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
    version: 0,

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
      if (!instruction || get().phase !== 'composing') return
      await get().request(instruction, currentSelection(get().hands))
    },

    request: async (instruction, selection) => {
      const { scoreId } = useEditor.getState()
      if (!scoreId || agentLocksScore(get().phase)) return
      set({ ...IDLE, phase: 'running', selection, instruction, source: 'bar' })
      try {
        // The agent must see every edit made so far.
        await settle()
        const job = await api.createEdit(scoreId, useEditor.getState().head, instruction, selection)
        set({ jobId: job.id })
        void follow(job.id)
      } catch (err) {
        fail(
          dailyLimit(err) ??
            (err instanceof ApiError && err.status === 409
              ? 'The score changed while sending the request. Try again.'
              : "Couldn't start the edit. Check that the API and worker are running."),
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
        settled({ ...IDLE, instruction: '' })
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
      settled({})
    },

    submitChat: async (content, selection) => {
      const { scoreId } = useEditor.getState()
      if (!scoreId || agentLocksScore(get().phase)) return false
      set({ ...IDLE, phase: 'running', source: 'chat', selection, instruction: content })
      try {
        await settle()
        const sent = await api.sendMessage(scoreId, useEditor.getState().head, content, selection)
        settled({ jobId: sent.job.id })
        void follow(sent.job.id)
        return true
      } catch (err) {
        fail(
          dailyLimit(err) ??
            (err instanceof ApiError && err.status === 409
              ? 'The score changed while sending. Try again.'
              : "Couldn't send the message. Check that the API and worker are running."),
        )
        return false
      }
    },
  }
})

/** While the agent is working or a proposal is up, the score can't be edited by hand. */
export function agentLocksScore(phase: Phase): boolean {
  return phase === 'running' || phase === 'ready'
}
