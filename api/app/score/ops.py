"""Edit operations: the one way a score changes, whether the user or the agent made the edit.

`apply_ops` is the source of truth. web/src/score/applyOps.ts mirrors it, and both run the shared
cases in fixtures/ops_cases.json so they cannot drift apart.

Ops are applied atomically: if any op fails, OpError is raised and the input score is untouched.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.score.model import (
    DENOMINATORS,
    Measure,
    Mode,
    Note,
    PitchName,
    Score,
    Staff,
    measure_ticks,
    note_sort_key,
)
from app.score.pitch import PIANO_HIGH, PIANO_LOW, key_fifths, to_midi

MAX_INSERT = 64


class _Op(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AddNote(_Op):
    op: Literal["add_note"] = "add_note"
    measure: int
    note: Note


class RemoveNote(_Op):
    op: Literal["remove_note"] = "remove_note"
    id: str


class NotePatch(_Op):
    measure: int | None = None
    staff: Staff | None = None
    voice: int | None = Field(default=None, ge=1, le=4)
    pitch: PitchName | None = None
    start: int | None = Field(default=None, ge=0)
    dur: int | None = Field(default=None, gt=0)
    tie: bool | None = None


class UpdateNote(_Op):
    op: Literal["update_note"] = "update_note"
    id: str
    set: NotePatch


class SetChord(_Op):
    op: Literal["set_chord"] = "set_chord"
    measure: int
    chord: str | None = Field(default=None, max_length=32)


class SetSection(_Op):
    op: Literal["set_section"] = "set_section"
    measure: int
    section: str | None = Field(default=None, max_length=64)


class InsertMeasures(_Op):
    op: Literal["insert_measures"] = "insert_measures"
    at: int = Field(ge=1)
    count: int = Field(default=1, ge=1, le=MAX_INSERT)


class DeleteMeasures(_Op):
    op: Literal["delete_measures"] = "delete_measures"
    at: int = Field(ge=1)
    count: int = Field(default=1, ge=1)


class MetaPatch(_Op):
    title: str | None = Field(default=None, max_length=200)
    key: str | None = None
    mode: Mode | None = None
    time: tuple[int, int] | None = None
    tempo: int | None = Field(default=None, ge=20, le=400)


class SetMeta(_Op):
    op: Literal["set_meta"] = "set_meta"
    set: MetaPatch


Op = Annotated[
    AddNote
    | RemoveNote
    | UpdateNote
    | SetChord
    | SetSection
    | InsertMeasures
    | DeleteMeasures
    | SetMeta,
    Field(discriminator="op"),
]
OpList = TypeAdapter(list[Op])


class OpError(Exception):
    def __init__(self, index: int, code: str, message: str):
        super().__init__(f"op {index}: {message}")
        self.index = index
        self.code = code
        self.message = message


class _Fail(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message


def apply_ops(score: Score, ops: list[Op]) -> Score:
    result = score.model_copy(deep=True)
    for index, op in enumerate(ops):
        try:
            _apply(result, op)
        except _Fail as fail:
            raise OpError(index, fail.code, fail.message) from None
    for i, measure in enumerate(result.measures):
        measure.n = i + 1
        measure.notes.sort(key=note_sort_key)
    return result


def _apply(score: Score, op: Op) -> None:
    match op:
        case AddNote():
            _add_note(score, op)
        case RemoveNote():
            m, i = _find_note(score, op.id)
            del score.measures[m].notes[i]
        case UpdateNote():
            _update_note(score, op)
        case SetChord():
            _measure(score, op.measure).chord = op.chord
        case SetSection():
            _measure(score, op.measure).section = op.section
        case InsertMeasures():
            _insert_measures(score, op)
        case DeleteMeasures():
            _delete_measures(score, op)
        case SetMeta():
            _set_meta(score, op)


def _measure(score: Score, n: int) -> Measure:
    if not 1 <= n <= len(score.measures):
        raise _Fail("measure_not_found", f"measure {n} does not exist")
    return score.measures[n - 1]


def _find_note(score: Score, note_id: str) -> tuple[int, int]:
    for m, measure in enumerate(score.measures):
        for i, note in enumerate(measure.notes):
            if note.id == note_id:
                return m, i
    raise _Fail("note_not_found", f"note {note_id} does not exist")


def _check_note(score: Score, note: Note) -> None:
    length = measure_ticks(score.meta)
    if note.start + note.dur > length:
        raise _Fail(
            "out_of_measure",
            f"note {note.id} ends at tick {note.start + note.dur}, past the measure end ({length})",
        )
    midi = to_midi(note.pitch)
    if not PIANO_LOW <= midi <= PIANO_HIGH:
        raise _Fail("out_of_range", f"note {note.id} ({note.pitch}) is outside the piano's range")


def _add_note(score: Score, op: AddNote) -> None:
    measure = _measure(score, op.measure)
    if any(n.id == op.note.id for m in score.measures for n in m.notes):
        raise _Fail("duplicate_id", f"note {op.note.id} already exists")
    note = op.note.model_copy()
    _check_note(score, note)
    measure.notes.append(note)


def _update_note(score: Score, op: UpdateNote) -> None:
    m, i = _find_note(score, op.id)
    changes = op.set.model_dump(exclude_none=True)
    target = changes.pop("measure", m + 1)
    note = score.measures[m].notes[i].model_copy(update=changes)
    destination = _measure(score, target)
    _check_note(score, note)
    del score.measures[m].notes[i]
    destination.notes.append(note)


def _insert_measures(score: Score, op: InsertMeasures) -> None:
    if op.at > len(score.measures) + 1:
        raise _Fail(
            "measure_not_found", f"cannot insert at {op.at}; score has {len(score.measures)}"
        )
    new = [Measure(n=op.at + k) for k in range(op.count)]
    score.measures[op.at - 1 : op.at - 1] = new


def _delete_measures(score: Score, op: DeleteMeasures) -> None:
    last = op.at + op.count - 1
    if last > len(score.measures):
        raise _Fail("measure_not_found", f"measures {op.at}-{last} do not all exist")
    if op.count >= len(score.measures):
        raise _Fail("last_measure", "a score needs at least one measure")
    del score.measures[op.at - 1 : last]


def _set_meta(score: Score, op: SetMeta) -> None:
    changes = op.set.model_dump(exclude_none=True)
    meta = score.meta.model_copy(update=changes)
    try:
        key_fifths(meta.key, meta.mode)
    except ValueError as err:
        raise _Fail("invalid_meta", str(err)) from None
    beats, unit = meta.time
    if not 1 <= beats <= 32 or unit not in DENOMINATORS:
        raise _Fail("invalid_meta", f"unsupported time signature {beats}/{unit}")
    length = measure_ticks(meta)
    for measure in score.measures:
        for note in measure.notes:
            if note.start + note.dur > length:
                raise _Fail(
                    "notes_overflow",
                    f"measure {measure.n} has notes past the end of a {beats}/{unit} bar",
                )
    score.meta = meta
