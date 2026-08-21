// Score playback through a sampled piano (Salamander Grand, hosted by the Tone.js project).
// The sampler loads lazily on first play; browsers only allow audio after a user gesture anyway.

import * as Tone from 'tone'
import { toMidi } from '../score/pitch'
import { measureTicks, type Score } from '../score/types'

const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/'
const LEAD_IN = 0.1

let sampler: Tone.Sampler | null = null
let loading: Promise<Tone.Sampler> | null = null

function samplerUrls(): Record<string, string> {
  // Salamander ships every minor third from A0 to C8; Tone pitch-shifts the notes between.
  const names = ['C', 'D#', 'F#', 'A']
  const urls: Record<string, string> = { A0: 'A0.mp3' }
  for (let octave = 1; octave <= 7; octave++) {
    for (const name of names) {
      urls[`${name}${octave}`] = `${name.replace('#', 's')}${octave}.mp3`
    }
  }
  urls.C8 = 'C8.mp3'
  return urls
}

function loadSampler(): Promise<Tone.Sampler> {
  if (sampler) return Promise.resolve(sampler)
  loading ??= new Promise((resolve, reject) => {
    const s = new Tone.Sampler({
      urls: samplerUrls(),
      baseUrl: SAMPLE_BASE,
      release: 1,
      onload: () => {
        sampler = s
        resolve(s)
      },
      onerror: (err) => {
        loading = null
        reject(err)
      },
    }).toDestination()
  })
  return loading
}

export type PlaybackCallbacks = {
  /** Called every animation frame with the notes sounding at the current playback position. */
  onSounding: (ids: Set<string>) => void
  onEnd: () => void
}

let frame = 0

/** Play from the start of a measure to the end of the score. */
export async function play(score: Score, fromMeasure: number, callbacks: PlaybackCallbacks) {
  await Tone.start()
  const piano = await loadSampler()
  const transport = Tone.getTransport()
  stop()

  const secondsPerTick = 60 / score.meta.tempo / score.meta.ppq
  const barSeconds = measureTicks(score.meta) * secondsPerTick
  const measures = score.measures.slice(fromMeasure - 1)
  const timeline: { id: string; on: number; off: number }[] = []

  measures.forEach((measure, i) => {
    for (const note of measure.notes) {
      const on = LEAD_IN + i * barSeconds + note.start * secondsPerTick
      const length = note.dur * secondsPerTick
      const name = Tone.Frequency(toMidi(note.pitch), 'midi').toNote()
      transport.schedule((time) => piano.triggerAttackRelease(name, length, time, 0.75), on)
      timeline.push({ id: note.id, on, off: on + length })
    }
  })
  const end = LEAD_IN + measures.length * barSeconds

  // Highlights are derived from the transport position each frame rather than scheduled as
  // on/off events, so a throttled or dropped frame can never leave a note stuck highlighted.
  const step = () => {
    const now = transport.seconds
    if (now >= end) {
      stop()
      callbacks.onSounding(new Set())
      callbacks.onEnd()
      return
    }
    callbacks.onSounding(new Set(timeline.filter((e) => e.on <= now && now < e.off).map((e) => e.id)))
    frame = requestAnimationFrame(step)
  }

  transport.start()
  frame = requestAnimationFrame(step)
}

export function stop() {
  cancelAnimationFrame(frame)
  const transport = Tone.getTransport()
  transport.stop()
  transport.cancel()
  sampler?.releaseAll()
}
