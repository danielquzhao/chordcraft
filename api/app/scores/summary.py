"""Human-readable descriptions of what a set of ops changed, for the History panel."""

from collections.abc import Iterable

from pydantic import BaseModel

from app.score.model import Score
from app.score.ops import (
    AddNote,
    DeleteMeasures,
    InsertMeasures,
    Op,
    RemoveNote,
    SetChord,
    SetMeta,
    SetSection,
    UpdateNote,
)


class Changes(BaseModel):
    kinds: list[str] = []
    measures: list[int] = []


def describe(before: Score, ops: Iterable[Op]) -> Changes:
    """What kinds of things the ops changed, and in which measures.

    Measure numbers are as of each op; later inserts or deletes in the same batch can shift
    them, which is fine for a label.
    """
    where = {note.id: m.n for m in before.measures for note in m.notes}
    kinds: set[str] = set()
    measures: set[int] = set()

    def touch(kind: str, measure: int | None = None) -> None:
        kinds.add(kind)
        if measure is not None:
            measures.add(measure)

    for op in ops:
        match op:
            case AddNote():
                where[op.note.id] = op.measure
                touch("notes", op.measure)
            case RemoveNote():
                touch("notes", where.pop(op.id, None))
            case UpdateNote():
                touch("notes", where.get(op.id))
                if op.set.measure is not None:
                    where[op.id] = op.set.measure
                    touch("notes", op.set.measure)
            case SetChord():
                touch("chords", op.measure)
            case SetSection():
                touch("sections", op.measure)
            case InsertMeasures():
                touch("measures_added")
            case DeleteMeasures():
                touch("measures_removed")
            case SetMeta():
                for field, value in op.set:
                    if value is not None:
                        touch(field)
    return Changes(kinds=sorted(kinds), measures=sorted(measures))


def merge(changes: Iterable[Changes]) -> Changes:
    kinds: set[str] = set()
    measures: set[int] = set()
    for c in changes:
        kinds.update(c.kinds)
        measures.update(c.measures)
    return Changes(kinds=sorted(kinds), measures=sorted(measures))


def measure_ranges(measures: list[int]) -> str:
    """[1, 2, 3, 5] -> "m. 1–3, 5"."""
    if not measures:
        return ""
    runs: list[tuple[int, int]] = []
    for n in sorted(measures):
        if runs and n == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], n)
        else:
            runs.append((n, n))
    parts = [str(a) if a == b else f"{a}–{b}" for a, b in runs]
    return "m. " + ", ".join(parts)


_PHRASES = {
    "notes": "Edited notes",
    "chords": "Changed chords",
    "sections": "Labelled sections",
    "measures_added": "Added measures",
    "measures_removed": "Removed measures",
    "title": "Renamed",
    "key": "Changed key",
    "mode": "Changed key",
    "time": "Changed time signature",
    "tempo": "Changed tempo",
}


# Phrases that read naturally with "in m. 3–5" after them.
_LOCAL = {"Edited notes", "Changed chords", "Labelled sections"}


def message(changes: Changes) -> str:
    """E.g. kinds ["notes", "tempo"] in m. 3-4 -> "Edited notes in m. 3–4, changed tempo"."""
    phrases: list[str] = []
    for kind, phrase in _PHRASES.items():
        if kind in changes.kinds and phrase not in phrases:
            phrases.append(phrase)
    if not phrases:
        return "No changes"
    where = measure_ranges(changes.measures)
    first = f"{phrases[0]} in {where}" if where and phrases[0] in _LOCAL else phrases[0]
    rest = [p[0].lower() + p[1:] for p in phrases[1:]]
    return ", ".join([first, *rest])
