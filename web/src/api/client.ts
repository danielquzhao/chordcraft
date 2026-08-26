// Typed client for the FastAPI backend (proxied at /api by Vite). Response shapes mirror
// api/app/scores/schemas.py.

import type { Op, Score } from '../score/types'

export type ScoreSummary = {
  id: string
  title: string
  head: number
  updated_at: string
}

export type ScoreDetail = ScoreSummary & { score: Score }

export type HistoryEntry = {
  number: number
  first_number: number
  author: 'user' | 'agent'
  kind: 'create' | 'edit' | 'restore'
  message: string
  created_at: string
}

export type RevisionDetail = {
  number: number
  message: string
  created_at: string
  score: Score
}

export type Selection = { start: number; end: number; staves: ('RH' | 'LH')[] }

export type AgentStep = { name: string; detail: string; ok: boolean }

export type Check = {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  details: string[]
}

export type Proposal = {
  status: 'ready' | 'failed'
  ops: Op[]
  summary: string
  report: { checks: Check[] } | null
  steps: AgentStep[]
  score: Score
  usage: Record<string, number>
  error: string | null
}

export type EditJob = {
  id: string
  score_id: string
  base: number
  instruction: string
  selection: Selection
  status: 'queued' | 'running' | 'ready' | 'failed' | 'accepted' | 'rejected'
  model: string
  proposal: Proposal | null
  error: string | null
  accepted_revision: number | null
  created_at: string
}

/** Server-sent progress events for an edit job (see api/app/edits/events.py). */
export type EditEvent =
  | ({ seq: number; type: 'step' } & AgentStep)
  | { seq: number; type: 'status'; status: string }
  | { seq: number; type: 'done'; status: EditJob['status']; error: string | null }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  job_id: string | null
  job_status: EditJob['status'] | null
  created_at: string
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(`API error ${status}`)
    this.status = status
    this.detail = detail
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    throw new ApiError(res.status, payload?.detail ?? payload)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const api = {
  listScores: () => request<ScoreSummary[]>('GET', '/scores'),
  createScore: (score?: Score) => request<ScoreDetail>('POST', '/scores', { score: score ?? null }),
  getScore: (id: string) => request<ScoreDetail>('GET', `/scores/${id}`),
  deleteScore: (id: string) => request<void>('DELETE', `/scores/${id}`),
  saveEdit: (id: string, base: number, ops: Op[]) =>
    request<{ head: number }>('POST', `/scores/${id}/revisions`, { base, ops }),
  restore: (id: string, base: number, number: number) =>
    request<ScoreDetail>('POST', `/scores/${id}/restore`, { base, number }),
  history: (id: string) => request<HistoryEntry[]>('GET', `/scores/${id}/history`),
  revision: (id: string, number: number) =>
    request<RevisionDetail>('GET', `/scores/${id}/revisions/${number}`),
  createEdit: (scoreId: string, base: number, instruction: string, selection: Selection) =>
    request<EditJob>('POST', `/scores/${scoreId}/edits`, { base, instruction, selection }),
  getEdit: (id: string) => request<EditJob>('GET', `/edits/${id}`),
  acceptEdit: (id: string) =>
    request<{ head: number; score: Score; ops: Op[] }>('POST', `/edits/${id}/accept`),
  rejectEdit: (id: string) => request<void>('POST', `/edits/${id}/reject`),
  importScore: async (file: File): Promise<ScoreDetail> => {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/scores/import', { method: 'POST', body })
    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      throw new ApiError(res.status, payload?.detail ?? payload)
    }
    return (await res.json()) as ScoreDetail
  },
  listMessages: (scoreId: string) => request<ChatMessage[]>('GET', `/scores/${scoreId}/messages`),
  sendMessage: (scoreId: string, base: number, content: string, selection: Selection) =>
    request<{ message: ChatMessage; job: EditJob }>('POST', `/scores/${scoreId}/messages`, {
      base,
      content,
      selection,
    }),
  /** EventSource URL for an edit's progress. */
  editEventsUrl: (id: string) => `/api/edits/${id}/events`,
}
