"""Import MusicXML and MIDI files into a ChordCraft score, via music21.

ChordCraft scores are one piano grand staff with one line per hand, so imports are folded
into that shape:
- Two or more parts: the first is the right hand, the second the left hand, any others are
  split by pitch. A single part (typical of MIDI) is split at middle C.
- Timing snaps to a 32nd-note grid. Notes that start together become a chord sharing one
  length; a note that starts while an earlier one in the same hand still sounds cuts it short.
- Key, time signature, tempo, title and chord symbols come across when the file has them.
"""

import tempfile
import uuid
from collections import defaultdict
from pathlib import Path

from music21 import converter, harmony, key, meter, stream, tempo
from music21 import note as m21note

from app.score.model import DENOMINATORS, Measure, Meta, Note, Score, measure_ticks
from app.score.pitch import ALTER_SYMBOLS, MAJOR_KEYS, MINOR_KEYS, PIANO_HIGH, PIANO_LOW

MAX_BYTES = 2_000_000
MAX_MEASURES = 400
PPQ = 480
GRID = PPQ // 8  # 32nd note
MIDDLE_C = 60

FORMATS = {
    ".musicxml": "musicxml",
    ".xml": "musicxml",
    ".mxl": "musicxml",
    ".mid": "midi",
    ".midi": "midi",
}


class ImportFailed(Exception):
    pass


def _snap(ticks: float) -> int:
    return int(round(ticks / GRID)) * GRID


def _key_name(fifths: int, mode: str) -> tuple[str, str]:
    table = MINOR_KEYS if mode == "minor" else MAJOR_KEYS
    for name, f in table.items():
        if f == fifths:
            return name, "minor" if mode == "minor" else "major"
    return "C", "major"


def _meta(parsed: stream.Score, title: str) -> Meta:
    k = parsed.recurse().getElementsByClass(key.KeySignature).first()
    if isinstance(k, key.Key):
        key_name, mode = _key_name(k.sharps, k.mode)
    elif k is not None:
        key_name, mode = _key_name(k.sharps, "major")
    else:
        key_name, mode = "C", "major"
    ts = parsed.recurse().getElementsByClass(meter.TimeSignature).first()
    time = (ts.numerator, ts.denominator) if ts and ts.denominator in DENOMINATORS else (4, 4)
    mm = parsed.recurse().getElementsByClass(tempo.MetronomeMark).first()
    bpm = int(round(mm.getQuarterBPM() or 92)) if mm else 92
    # MusicXML titles can be a work title or a movement title; bestTitle checks both.
    meta_title = (parsed.metadata.bestTitle if parsed.metadata else None) or title
    return Meta(
        title=meta_title[:200],
        key=key_name,
        mode=mode,  # type: ignore[arg-type]
        time=time,
        tempo=min(400, max(20, bpm)),
        ppq=PPQ,
    )


def _spell(p) -> str | None:
    alter = p.accidental.alter if p.accidental else 0
    if alter != int(alter) or int(alter) not in ALTER_SYMBOLS or p.octave is None:
        return None  # microtones or unpitched
    if not PIANO_LOW <= p.midi <= PIANO_HIGH:
        return None
    return f"{p.step}{ALTER_SYMBOLS[int(alter)]}{p.octave}"


def _tidy(notes: list[Note]) -> list[Note]:
    """One line per hand: chords share a length, and a later onset cuts the earlier one short."""
    by_start: dict[int, list[Note]] = defaultdict(list)
    for n in notes:
        by_start[n.start].append(n)
    starts = sorted(by_start)
    out: list[Note] = []
    for i, start in enumerate(starts):
        group = by_start[start]
        dur = max(n.dur for n in group)
        if i + 1 < len(starts):
            dur = min(dur, starts[i + 1] - start)
        seen: set[str] = set()
        for n in group:
            if n.pitch in seen:
                continue  # the same pitch twice in one chord
            seen.add(n.pitch)
            out.append(n.model_copy(update={"dur": dur}))
    return out


def import_score(data: bytes, filename: str) -> Score:
    if len(data) > MAX_BYTES:
        raise ImportFailed("That file is too large (2 MB limit).")
    suffix = Path(filename).suffix.lower()
    fmt = FORMATS.get(suffix)
    if fmt is None:
        raise ImportFailed("Use a MusicXML (.musicxml, .xml, .mxl) or MIDI (.mid) file.")

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"upload{suffix}"
        path.write_bytes(data)
        try:
            parsed = (
                converter.parse(path, quantizePost=True) if fmt == "midi" else converter.parse(path)
            )
        except Exception as err:
            raise ImportFailed(f"Couldn't read that file as {fmt.upper()}.") from err
    if not isinstance(parsed, stream.Score):
        wrapper = stream.Score()
        wrapper.insert(0, parsed)
        parsed = wrapper

    meta = _meta(parsed, Path(filename).stem)
    length = measure_ticks(meta)
    parts = list(parsed.parts) or [parsed]
    part_measures = []
    for part in parts:
        measures = list(part.getElementsByClass(stream.Measure))
        if not measures:
            measures = list(part.makeMeasures().getElementsByClass(stream.Measure))
        part_measures.append(measures)
    count = min(MAX_MEASURES, max((len(ms) for ms in part_measures), default=0))
    if count == 0:
        raise ImportFailed("That file has no measures to import.")

    notes: dict[tuple[int, str], list[Note]] = defaultdict(list)
    chords: dict[int, str] = {}
    for p_index, measures in enumerate(part_measures):
        for m_index, m in enumerate(measures[:count]):
            for symbol in m.recurse().getElementsByClass(harmony.ChordSymbol):
                chords.setdefault(m_index + 1, symbol.figure[:32])
            for el in m.recurse().notes:
                if isinstance(el, harmony.ChordSymbol) or el.duration.isGrace:
                    continue
                start = _snap(float(el.getOffsetInHierarchy(m)) * PPQ)
                dur = max(GRID, _snap(float(el.quarterLength) * PPQ))
                if start >= length:
                    continue
                dur = min(dur, length - start)
                pitches = el.pitches if not isinstance(el, m21note.Note) else [el.pitch]
                for p in pitches:
                    name = _spell(p)
                    if name is None:
                        continue
                    if len(parts) >= 2 and p_index < 2:
                        staff = "RH" if p_index == 0 else "LH"
                    else:
                        staff = "RH" if p.midi >= MIDDLE_C else "LH"
                    notes[(m_index + 1, staff)].append(
                        Note(
                            id=f"n_{uuid.uuid4().hex[:10]}",
                            staff=staff,  # type: ignore[arg-type]
                            pitch=name,
                            start=start,
                            dur=dur,
                        )
                    )

    measures_out = []
    for n in range(1, count + 1):
        hand_notes = [*_tidy(notes[(n, "RH")]), *_tidy(notes[(n, "LH")])]
        measures_out.append(Measure(n=n, chord=chords.get(n), notes=hand_notes))
    if not any(m.notes for m in measures_out):
        raise ImportFailed("That file has no notes ChordCraft can show.")
    return Score(meta=meta, measures=measures_out)
