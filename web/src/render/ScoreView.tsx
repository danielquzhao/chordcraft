import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useEditor } from '../editor/store'
import { engrave, markNotes, type Layout } from './engrave'
import { cursorLine, hitTest } from './geometry'

/** VexFlow measures glyphs while laying out, so wait for the music font before the first draw. */
function useMusicFont(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    Promise.all([document.fonts.load('30px Bravura'), document.fonts.load('12px Academico')])
      .catch(() => undefined)
      .then(() => setReady(true))
  }, [])
  return ready
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

type Props = {
  /** The element VexFlow draws into; the editor also uses it for playback highlights. */
  hostRef: RefObject<HTMLDivElement | null>
}

export function ScoreView({ hostRef }: Props) {
  const score = useEditor((s) => s.score)
  const cursor = useEditor((s) => s.cursor)
  const selected = useEditor((s) => s.selected)
  const moveTo = useEditor((s) => s.moveTo)
  const wrapRef = useRef<HTMLDivElement>(null)
  const width = useWidth(wrapRef)
  const fontReady = useMusicFont()
  const [layout, setLayout] = useState<Layout | null>(null)

  useLayoutEffect(() => {
    if (!hostRef.current || !fontReady || width < 200) return
    setLayout(engrave(hostRef.current, score, width))
  }, [hostRef, score, width, fontReady])

  useLayoutEffect(() => {
    if (hostRef.current) markNotes(hostRef.current, 'is-selected', selected ? [selected] : [])
  }, [hostRef, layout, selected])

  const line = layout ? cursorLine(layout, cursor) : null

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!layout || !hostRef.current) return
    const rect = hostRef.current.getBoundingClientRect()
    const hit = hitTest(layout, e.clientX - rect.left, e.clientY - rect.top)
    if (hit) moveTo({ cursor: hit.cursor, selected: hit.select })
  }

  return (
    <div ref={wrapRef} className="score">
      <div
        ref={hostRef}
        className="score-host"
        onPointerDown={onPointerDown}
        role="img"
        aria-label={`Score: ${score.meta.title}, ${score.measures.length} measures`}
      />
      {line && (
        <div
          className="score-cursor"
          style={{ left: line.x, top: line.top, height: line.bottom - line.top }}
          aria-hidden="true"
        />
      )}
      {!fontReady && <p className="score-loading">Loading notation font…</p>}
    </div>
  )
}
