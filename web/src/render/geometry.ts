// Geometry over a rendered Layout: what a click hit, and where the cursor line goes.

import type { Cursor } from '../input/noteEntry'
import type { Staff } from '../score/types'
import type { EventBox, Layout, MeasureBox } from './engrave'

const HEAD_HIT = 8

export type Hit = { cursor: Cursor; select: string | null }

function staffEventsAt(layout: Layout, measure: number, staff: Staff): EventBox[] {
  return layout.events
    .filter((e) => e.measure === measure && e.staff === staff)
    .sort((a, b) => a.start - b.start)
}

function measureAt(layout: Layout, px: number, py: number): MeasureBox | undefined {
  return layout.measures.find(
    (m) =>
      px >= m.x &&
      px < m.x + m.width &&
      py >= m.staves.RH.top - 60 &&
      py <= m.staves.LH.bottom + 60,
  )
}

/** Clicking a notehead selects it; clicking elsewhere on a staff moves the cursor there. */
export function hitTest(layout: Layout, px: number, py: number): Hit | null {
  const m = measureAt(layout, px, py)
  if (!m) return null
  const mid = (s: Staff) => (m.staves[s].top + m.staves[s].bottom) / 2
  const staff: Staff = Math.abs(py - mid('RH')) <= Math.abs(py - mid('LH')) ? 'RH' : 'LH'
  const events = staffEventsAt(layout, m.n, staff)
  if (!events.length) return null
  const event = [...events].reverse().find((e) => e.x <= px + HEAD_HIT) ?? events[0]
  const cursor: Cursor = { measure: m.n, staff, tick: event.start }

  let best: string | null = null
  let bestDistance = HEAD_HIT
  event.ys.forEach((y, i) => {
    const d = Math.abs(y - py)
    if (d <= bestDistance) {
      best = event.ids[i]
      bestDistance = d
    }
  })
  return { cursor, select: best }
}

export type CursorLine = { x: number; top: number; bottom: number }

/** Where to draw the insertion cursor: at its tick, between the surrounding events. */
export function cursorLine(layout: Layout, cursor: Cursor): CursorLine | null {
  const m = layout.measures.find((x) => x.n === cursor.measure)
  if (!m) return null
  const events = staffEventsAt(layout, cursor.measure, cursor.staff)
  const i = events.findIndex((e) => cursor.tick >= e.start && cursor.tick < e.start + e.dur)
  const staff = m.staves[cursor.staff]
  const bounds = { top: staff.top - 14, bottom: staff.bottom + 14 }
  if (i === -1) return { x: m.noteEndX - 6, ...bounds }
  const event = events[i]
  const nextX = events[i + 1]?.x ?? m.noteEndX
  const fraction = (cursor.tick - event.start) / event.dur
  return { x: event.x - 5 + fraction * (nextX - event.x), ...bounds }
}
