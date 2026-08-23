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
}
