// Draws a score as piano grand staves with VexFlow and reports where everything landed, so the
// editor can hit-test clicks and place the cursor. Selection and playback highlights are applied
// afterwards as CSS classes on the SVG (see markNotes), so they don't require a re-render.

import {
  Accidental,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  GhostNote,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Voice,
  VoiceMode,
  type RenderContext,
  type Tickable,
} from 'vexflow/bravura'
import { decompose, staffEvents, type StaffEvent } from '../score/events'
import { keyFifths, parsePitch } from '../score/pitch'
import type { Measure, Meta, Note, Score, Staff } from '../score/types'

const INK = '#1c1b18'
/** Removed notes in a proposed edit (matches --removed in index.css). */
const REMOVED = '#b4531c'
const CHORD_FONT = 'Geist, ui-sans-serif, system-ui, sans-serif'

/** Distance from the treble stave's y to the bass stave's y. */
const STAFF_GAP = 96
/** Vertical space each grand-staff system takes, including room for chord symbols. */
const SYSTEM_HEIGHT = 250
/** A lead sheet has one staff per system, with room for large chord symbols. */
const LEAD_SYSTEM_HEIGHT = 150
const LEAD_CHORD_FONT = "'Instrument Serif', Georgia, serif"
const TOP = 24
const MIN_MEASURE = 150
const PER_PIECE = 34

export type EventBox = {
  measure: number
  staff: Staff
  start: number
  dur: number
  /** Left edge of the first notehead. */
  x: number
  /** Note ids, lowest pitch first; empty for a rest. */
  ids: string[]
  /** Notehead y positions, matching ids. */
  ys: number[]
}

export type MeasureBox = {
  n: number
  system: number
  x: number
  width: number
  noteStartX: number
  noteEndX: number
  staves: Record<Staff, { top: number; bottom: number }>
}

export type Layout = {
  width: number
  height: number
  measures: MeasureBox[]
  events: EventBox[]
}

const CLEF: Record<Staff, string> = { RH: 'treble', LH: 'bass' }
const REST_KEY: Record<Staff, string> = { RH: 'b/4', LH: 'd/3' }

export function keySpec(meta: Meta): string {
  return meta.mode === 'minor' ? `${meta.key}m` : meta.key
}

function vfKey(pitch: string): string {
  const p = parsePitch(pitch)
  const accidental = { 0: '', 1: '#', 2: '##', [-1]: 'b', [-2]: 'bb' }[p.alter]
  return `${p.step.toLowerCase()}${accidental}/${p.octave}`
}

/** Rough width a measure needs, from how many note values its busiest staff shows. */
function naturalWidth(measure: Measure, meta: Meta, staves: Staff[]): number {
  const pieces = (staff: Staff) =>
    staffEvents(measure, staff, meta).reduce((sum, e) => sum + decompose(e.dur, meta.ppq).length, 0)
  return Math.max(MIN_MEASURE, 40 + PER_PIECE * Math.max(...staves.map(pieces)))
}

function beginWidth(meta: Meta, withTime: boolean): number {
  return 48 + 11 * Math.abs(keyFifths(meta.key, meta.mode)) + (withTime ? 28 : 0)
}

/** Greedily pack measures into systems, then stretch each full system to the page width. */
function planSystems(score: Score, width: number, staves: Staff[]): { n: number; width: number }[][] {
  const systems: { n: number; width: number }[][] = []
  let current: { n: number; width: number }[] = []
  let used = 0
  score.measures.forEach((m) => {
    const first = current.length === 0
    const w =
      naturalWidth(m, score.meta, staves) + (first ? beginWidth(score.meta, systems.length === 0) : 0)
    if (!first && used + w > width) {
      systems.push(current)
      current = []
      used = 0
      const lead = naturalWidth(m, score.meta, staves) + beginWidth(score.meta, false)
      current.push({ n: m.n, width: lead })
      used = lead
      return
    }
    current.push({ n: m.n, width: w })
    used += w
  })
  if (current.length) systems.push(current)

  return systems.map((system, i) => {
    const total = system.reduce((s, m) => s + m.width, 0)
    const isLast = i === systems.length - 1
    // Leave a short final system at its natural width rather than stretching two bars across.
    const scale = isLast && total < width * 0.6 ? 1 : width / total
    return system.map((m) => ({ n: m.n, width: Math.floor(m.width * scale) }))
  })
}

type Built = { notes: StaveNote[]; ties: StaveTie[]; boxes: { event: StaffEvent; note: StaveNote }[] }

function buildStaff(events: StaffEvent[], staff: Staff, meta: Meta): Built {
  const built: Built = { notes: [], ties: [], boxes: [] }
  const length = (meta.time[0] * meta.ppq * 4) / meta.time[1]
  for (const event of events) {
    const isRest = event.notes.length === 0
    if (isRest && event.start === 0 && event.dur === length) {
      // A whole-bar rest is centred, whatever the meter.
      const rest = new StaveNote({
        keys: [REST_KEY[staff]], duration: 'wr', clef: CLEF[staff], alignCenter: true,
      })
      built.notes.push(rest)
      built.boxes.push({ event, note: rest })
      continue
    }
    const keys = isRest ? [REST_KEY[staff]] : event.notes.map((n) => vfKey(n.pitch))
    const pieces = decompose(event.dur, meta.ppq).map((token) => {
      const note = new StaveNote({
        keys,
        duration: token.duration + (isRest ? 'r' : ''),
        dots: token.dots,
        clef: CLEF[staff],
        autoStem: true,
      })
      if (token.dots) Dot.buildAndAttach([note], { all: true })
      return note
    })
    if (!pieces.length) continue
    built.notes.push(...pieces)
    built.boxes.push({ event, note: pieces[0] })
    if (!isRest) {
      const indexes = keys.map((_, i) => i)
      for (let i = 1; i < pieces.length; i++) {
        built.ties.push(
          new StaveTie({
            firstNote: pieces[i - 1], lastNote: pieces[i], firstIndexes: indexes, lastIndexes: indexes,
          }),
        )
      }
    }
  }
  return built
}

/**
 * Notes a proposed edit removes, as a second voice: orange noteheads, with invisible
 * spacers for the gaps so they line up with the beats they used to occupy.
 */
function buildGhosts(notes: Note[], staff: Staff, meta: Meta): Tickable[] | null {
  if (!notes.length) return null
  const measure: Measure = {
    n: 0, chord: null, section: null, notes: notes.map((x) => ({ ...x, staff, voice: 1 })),
  }
  const tickables: Tickable[] = []
  for (const event of staffEvents(measure, staff, meta)) {
    for (const token of decompose(event.dur, meta.ppq)) {
      if (!event.notes.length) {
        tickables.push(new GhostNote({ duration: token.duration, dots: token.dots }))
        continue
      }
      const note = new StaveNote({
        keys: event.notes.map((n) => vfKey(n.pitch)),
        duration: token.duration,
        dots: token.dots,
        clef: CLEF[staff],
        autoStem: true,
      })
      if (token.dots) Dot.buildAndAttach([note], { all: true })
      note.setStyle({ fillStyle: REMOVED, strokeStyle: REMOVED })
      note.setLedgerLineStyle({ fillStyle: REMOVED, strokeStyle: REMOVED })
      tickables.push(note)
    }
  }
  return tickables
}

function drawText(
  ctx: RenderContext, text: string, x: number, y: number, size: number, weight: number,
  font = CHORD_FONT,
) {
  ctx.save()
  ctx.setFont(font, size, weight)
  ctx.fillText(text, x, y)
  ctx.restore()
}

export type View = 'score' | 'lead'

/**
 * Draw the score: the grand staff, or for a lead sheet just the melody with large chord
 * symbols. `ghosts` (measure number → notes) adds removed notes from a proposed edit as
 * faded orange notes alongside the new ones.
 */
export function engrave(
  container: HTMLDivElement,
  score: Score,
  width: number,
  ghosts?: Map<number, Note[]>,
  view: View = 'score',
): Layout {
  container.innerHTML = ''
  const { meta } = score
  const lead = view === 'lead'
  const parts: Staff[] = lead ? ['RH'] : ['RH', 'LH']
  const systemHeight = lead ? LEAD_SYSTEM_HEIGHT : SYSTEM_HEIGHT
  const systems = planSystems(score, width, parts)
  const height = TOP + systems.length * systemHeight

  const renderer = new Renderer(container, Renderer.Backends.SVG)
  renderer.resize(width, height)
  const ctx = renderer.getContext()
  ctx.setFillStyle(INK)
  ctx.setStrokeStyle(INK)

  const layout: Layout = { width, height, measures: [], events: [] }
  const key = keySpec(meta)
  const lastN = score.measures.length

  systems.forEach((system, s) => {
    const y = TOP + s * systemHeight + (lead ? 40 : 30)
    let x = 0
    system.forEach(({ n, width: w }, i) => {
      const measure = score.measures[n - 1]
      const treble = new Stave(x, y, w)
      const bass = lead ? null : new Stave(x, y + STAFF_GAP, w)
      const drawn = bass ? [treble, bass] : [treble]
      if (i === 0) {
        treble.addClef('treble').addKeySignature(key)
        bass?.addClef('bass').addKeySignature(key)
        if (s === 0) drawn.forEach((st) => st.addTimeSignature(`${meta.time[0]}/${meta.time[1]}`))
      }
      if (n === lastN) drawn.forEach((st) => st.setEndBarType(BarlineType.END))
      Stave.formatBegModifiers(drawn)
      drawn.forEach((st) => st.setContext(ctx).draw())

      if (i === 0) drawText(ctx, String(n), x + 2, treble.getYForLine(0) - 14, 11, 400)
      if (bass) {
        if (i === 0) {
          new StaveConnector(treble, bass).setType('brace').setContext(ctx).draw()
          new StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw()
        }
        new StaveConnector(treble, bass)
          .setType(n === lastN ? 'boldDoubleRight' : 'singleRight')
          .setContext(ctx)
          .draw()
      }

      const staves: Partial<Record<Staff, Stave>> = { RH: treble, LH: bass ?? undefined }
      const built = Object.fromEntries(
        parts.map((staff) => [staff, buildStaff(staffEvents(measure, staff, meta), staff, meta)]),
      ) as Record<Staff, Built>
      const newVoice = (tickables: Tickable[]) =>
        new Voice({ numBeats: meta.time[0], beatValue: meta.time[1] })
          .setMode(VoiceMode.SOFT)
          .addTickables(tickables)
      const ghostNotes = ghosts?.get(n) ?? []
      const ghostVoices = Object.fromEntries(
        parts.map((staff) => [staff, buildGhosts(ghostNotes.filter((x) => x.staff === staff), staff, meta)]),
      ) as Record<Staff, Tickable[] | null>
      const formatter = new Formatter()
      const voices = parts.map((staff) => {
        const main = newVoice(built[staff].notes)
        const ghost = ghostVoices[staff] && newVoice(ghostVoices[staff])
        const onStaff = ghost ? [main, ghost] : [main]
        Accidental.applyAccidentals(onStaff, key)
        formatter.joinVoices(onStaff)
        return { main, ghost }
      })
      formatter.format(
        voices.flatMap((v) => (v.ghost ? [v.main, v.ghost] : [v.main])),
        Math.max(40, treble.getNoteEndX() - treble.getNoteStartX() - 14),
      )

      parts.forEach((staff, k) => {
        const stave = staves[staff]!
        // generateBeams breaks beams at rests itself, so pass every note in order.
        const beams = Beam.generateBeams(built[staff].notes)
        voices[k].main.draw(ctx, stave)
        beams.forEach((b) => b.setContext(ctx).draw())
        built[staff].ties.forEach((t) => t.setContext(ctx).draw())
        if (voices[k].ghost) {
          voices[k].ghost.draw(ctx, stave)
          for (const t of ghostVoices[staff] ?? []) t.getSVGElement()?.setAttribute('data-ghost', '')
        }

        for (const { event, note } of built[staff].boxes) {
          const ids = event.notes.map((x) => x.id)
          note.getSVGElement()?.setAttribute('data-note-ids', ids.join(' '))
          note.noteHeads.forEach((head, h) => {
            if (ids[h]) head.getSVGElement()?.setAttribute('data-note-id', ids[h])
          })
          layout.events.push({
            measure: n, staff, start: event.start, dur: event.dur,
            x: note.getAbsoluteX(), ids, ys: ids.length ? note.getYs() : [],
          })
        }
      })

      if (measure.chord) {
        if (lead) {
          drawText(ctx, measure.chord, treble.getNoteStartX(), treble.getYForLine(0) - 34, 26, 400, LEAD_CHORD_FONT)
        } else {
          drawText(ctx, measure.chord, treble.getNoteStartX(), treble.getYForLine(0) - 30, 15, 600)
        }
      }

      layout.measures.push({
        n, system: s, x, width: w,
        noteStartX: treble.getNoteStartX(),
        noteEndX: treble.getNoteEndX(),
        staves: {
          RH: { top: treble.getYForLine(0), bottom: treble.getYForLine(4) },
          // A lead sheet has no bass staff; point LH at the melody so geometry still works.
          LH: bass
            ? { top: bass.getYForLine(0), bottom: bass.getYForLine(4) }
            : { top: treble.getYForLine(0), bottom: treble.getYForLine(4) },
        },
      })
      x += w
    })
  })

  return layout
}

/** Toggle a CSS class on the noteheads for these ids (selection, playback). */
export function markNotes(container: HTMLElement, className: string, ids: Iterable<string>) {
  container.querySelectorAll(`.${className}`).forEach((el) => el.classList.remove(className))
  for (const id of ids) {
    container
      .querySelectorAll(`[data-note-id="${CSS.escape(id)}"]`)
      .forEach((el) => el.classList.add(className))
  }
}
