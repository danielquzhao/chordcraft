import { useEffect, useRef, useState } from 'react'
import { api, type ChatMessage } from '../api/client'
import { useEditor } from '../editor/store'
import { describeSelection, mentionInProgress, mentionSuggestions, parseMentions } from './mentions'
import { agentLocksScore, useAgent } from './store'

const STATUS_NOTE: Partial<Record<NonNullable<ChatMessage['job_status']>, string>> = {
  accepted: 'Applied',
  rejected: 'Discarded',
  failed: 'Couldn’t finish',
}

function Sparkle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />
    </svg>
  )
}

/** Inline text: **bold** and @mentions. Built as React nodes, never as HTML. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|@[\w.\-–]+)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={i}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('@')) return <span key={i} className="mention">{part}</span>
        return part
      })}
    </>
  )
}

/** The small subset of Markdown the agent writes: paragraphs, "- " bullet lists, bold. */
function MessageText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = []
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const last = blocks.at(-1)
    if (!line.trim()) {
      blocks.push({ list: false, lines: [] })
    } else if (bullet) {
      if (last?.list) last.lines.push(bullet[1])
      else blocks.push({ list: true, lines: [bullet[1]] })
    } else if (last && !last.list && last.lines.length) {
      last.lines.push(line)
    } else {
      blocks.push({ list: false, lines: [line] })
    }
  }
  return (
    <>
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.list ? (
            <ul key={i}>
              {b.lines.map((line, j) => (
                <li key={j}>
                  <Inline text={line} />
                </li>
              ))}
            </ul>
          ) : (
            <p key={i}>
              <Inline text={b.lines.join('\n')} />
            </p>
          ),
        )}
    </>
  )
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const scoreId = useEditor((s) => s.scoreId)
  const measureCount = useEditor((s) => s.score?.measures.length ?? 1)
  const range = useEditor((s) => s.range)
  const cursorMeasure = useEditor((s) => s.cursor.measure)
  const phase = useAgent((s) => s.phase)
  const source = useAgent((s) => s.source)
  const jobId = useAgent((s) => s.jobId)
  const steps = useAgent((s) => s.steps)
  const error = useAgent((s) => s.error)
  const busy = useAgent((s) => s.busy)
  const version = useAgent((s) => s.version)
  const { accept, reject, submitChat } = useAgent.getState()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!scoreId) return
    let live = true
    api
      .listMessages(scoreId)
      .then((m) => live && setMessages(m))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [scoreId, version])

  const working = source === 'chat' && phase === 'running'
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, steps, working])

  const ctx = { measureCount, range }
  const selection = parseMentions(draft, ctx)
  const typingMention = mentionInProgress(draft)
  const suggestions = typingMention
    ? mentionSuggestions({ ...ctx, cursorMeasure }).filter((s) =>
        s.toLowerCase().startsWith(typingMention.toLowerCase()),
      )
    : []
  const locked = agentLocksScore(phase)

  function insertMention(mention: string) {
    setDraft((d) => d.replace(/@[\w.\-–]*$/, `${mention} `))
    inputRef.current?.focus()
  }

  async function send() {
    const content = draft.trim()
    if (!content || locked) return
    if (await submitChat(content, selection)) setDraft('')
  }

  return (
    <aside className="chat" aria-label="Agent chat">
      <header className="chat-header">
        <span className="chat-title">
          <Sparkle /> Agent
        </span>
        <button type="button" className="row-action visible" aria-label="Close chat" title="Close (⌘L)" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && !working && (
          <div className="chat-empty">
            <h2>Ask about the music, or for a change</h2>
            <p>
              Mention measures and hands to point at them, like <span className="mention">@m.5–8</span>{' '}
              <span className="mention">@LH</span>. Without a mention, the agent works on your
              selection, or the whole score.
            </p>
            <ul>
              <li>“What chords are in the verse?”</li>
              <li>“@m.1–4 @LH Alberti bass in eighth notes”</li>
              <li>“Make the melody in @m.7 more rhythmic”</li>
            </ul>
          </div>
        )}

        {messages.map((m) => {
          const reviewing = m.role === 'assistant' && m.job_id === jobId && phase === 'ready'
          const note = m.role === 'assistant' && m.job_status ? STATUS_NOTE[m.job_status] : undefined
          return (
            <div key={m.id} className={`chat-message ${m.role}`}>
              <div className="chat-bubble">
                <MessageText text={m.content} />
              </div>
              {reviewing && (
                <div className="chat-review">
                  <span>Proposed on the score</span>
                  <button type="button" className="tool text" onClick={() => void reject()} disabled={busy}>
                    Reject
                  </button>
                  <button type="button" className="primary small" onClick={() => void accept()} disabled={busy}>
                    Accept
                  </button>
                </div>
              )}
              {note && !reviewing && <span className={`chat-note ${m.job_status}`}>{note}</span>}
            </div>
          )
        })}

        {working && (
          <div className="chat-message assistant">
            <div className="chat-steps" role="status" aria-live="polite">
              <span className="chat-working">
                <span className="spinner" aria-hidden="true" /> Working…
              </span>
              <ol>
                {steps.slice(-6).map((s, i) => (
                  <li key={i} className={s.ok ? '' : 'bad'}>
                    <span aria-hidden="true">{s.ok ? '✓' : '✗'}</span> {s.name}
                    <span className="step-detail">{s.detail}</span>
                  </li>
                ))}
              </ol>
              <button type="button" className="tool text" onClick={() => void reject()}>
                Stop
              </button>
            </div>
          </div>
        )}

        {source === 'chat' && phase === 'failed' && error && (
          <p className="chat-error" role="alert">{error}</p>
        )}
      </div>

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        {suggestions.length > 0 && (
          <div className="mention-suggestions" role="listbox" aria-label="Mentions">
            {suggestions.map((s) => (
              <button key={s} type="button" role="option" aria-selected="false" className="mention-option" onClick={() => insertMention(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <label className="sr-only" htmlFor="chat-input">Message the agent</label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={3}
          value={draft}
          maxLength={2000}
          placeholder={
            phase === 'ready'
              ? 'Accept or reject the proposed edit first.'
              : phase === 'running'
                ? 'The agent is working…'
                : 'Ask a question or describe a change. Type @ to point at measures.'
          }
          disabled={locked}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && suggestions.length) {
              e.preventDefault()
              insertMention(suggestions[0])
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="chat-composer-row">
          <span className="chat-context">Context: {describeSelection(selection, measureCount)}</span>
          <button type="submit" className="send" aria-label="Send" disabled={!draft.trim() || locked}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
      </form>
    </aside>
  )
}
