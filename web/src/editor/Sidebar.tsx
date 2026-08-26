import type { HistoryEntry } from '../api/client'
import { useEditor } from './store'

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86400 * 7) return relative.format(Math.round(seconds / 86400), 'day')
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function versionLabel(entry: HistoryEntry): string {
  return entry.first_number === entry.number ? `v${entry.number}` : `v${entry.first_number}–${entry.number}`
}

export function Sidebar() {
  const scores = useEditor((s) => s.scores)
  const scoreId = useEditor((s) => s.scoreId)
  const history = useEditor((s) => s.history)
  const head = useEditor((s) => s.head)
  const preview = useEditor((s) => s.preview)
  const { open, startNew, deleteScore, showRevision } = useEditor.getState()
  const screen = useEditor((s) => s.screen)

  return (
    <nav className="sidebar" aria-label="Workspace">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </svg>
        ChordCraft
      </div>

      <section className="side-section" aria-labelledby="scores-heading">
        <h2 id="scores-heading" className="side-heading">Scores</h2>
        <ul className="side-list">
          {scores.map((s) => (
            <li key={s.id} className="score-row">
              <a
                href={`/scores/${s.id}`}
                className="side-item"
                aria-current={s.id === scoreId && screen === 'editor' ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  void open(s.id)
                }}
              >
                {s.title}
              </a>
              <button
                type="button"
                className="row-action"
                aria-label={`Delete ${s.title}`}
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete "${s.title}" and its history? This can't be undone.`)) {
                    void deleteScore(s.id)
                  }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="side-item new"
          aria-current={screen === 'new' ? 'page' : undefined}
          onClick={() => void startNew()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New score
        </button>
      </section>

      {screen === 'editor' && (
      <section className="side-section" aria-labelledby="history-heading">
        <h2 id="history-heading" className="side-heading">History</h2>
        <ol className="side-list">
          {history.map((entry) => {
            const isHead = entry.number === head
            const viewing = preview?.number === entry.number
            return (
              <li key={entry.number}>
                <button
                  type="button"
                  className="history-item"
                  aria-pressed={viewing || (isHead && !preview)}
                  onClick={() => void showRevision(isHead ? null : entry.number)}
                >
                  <span className="history-top">
                    <span className="history-message">{entry.message}</span>
                    <span className="history-version">{versionLabel(entry)}</span>
                  </span>
                  <span className="history-meta">
                    {entry.author === 'agent' ? 'Agent' : 'You'} · {timeAgo(entry.created_at)}
                    {isHead && ' · Current'}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>
      )}
    </nav>
  )
}
