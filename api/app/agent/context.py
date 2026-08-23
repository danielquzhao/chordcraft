"""What the model sees: the selection plus nearby measures, as compact text."""

from pydantic import BaseModel, Field, model_validator

from app.agent.timing import beat_ticks, duration_name, tick_to_beat
from app.score.model import Score, Staff, measure_ticks, note_sort_key

CONTEXT_MEASURES = 2
HANDS = {"RH": "right hand (treble staff)", "LH": "left hand (bass staff)"}


class Selection(BaseModel):
    """Measures start..end inclusive, on the given staves."""

    start: int = Field(ge=1)
    end: int = Field(ge=1)
    staves: list[Staff] = Field(default_factory=lambda: ["RH", "LH"], min_length=1)

    @model_validator(mode="after")
    def _ordered(self) -> "Selection":
        if self.end < self.start:
            raise ValueError("selection end is before its start")
        return self

    def contains(self, measure: int, staff: str) -> bool:
        return self.start <= measure <= self.end and staff in self.staves

    def describe(self) -> str:
        bars = f"m. {self.start}" if self.start == self.end else f"m. {self.start}–{self.end}"
        hands = " and ".join(HANDS[s] for s in self.staves)
        return f"{bars}, {hands}"


def key_name(score: Score) -> str:
    return f"{score.meta.key.replace('b', '♭').replace('#', '♯')} {score.meta.mode}"


def render_measure(score: Score, n: int) -> str:
    measure = score.measures[n - 1]
    chord = f" [{measure.chord}]" if measure.chord else ""
    section = f" ({measure.section})" if measure.section else ""
    lines = [f"m{n}{chord}{section}"]
    for staff in ("RH", "LH"):
        notes = sorted((x for x in measure.notes if x.staff == staff), key=note_sort_key)
        if not notes:
            lines.append(f"  {staff}: (rest)")
            continue
        parts = [
            f"{x.id} {x.pitch} @{tick_to_beat(x.start, score.meta)} "
            f"{duration_name(x.dur, score.meta)}" + (f" v{x.voice}" if x.voice != 1 else "")
            for x in notes
        ]
        lines.append(f"  {staff}: " + " | ".join(parts))
    return "\n".join(lines)


def render_context(score: Score, selection: Selection) -> str:
    meta = score.meta
    beats, unit = meta.time
    first = max(1, selection.start - CONTEXT_MEASURES)
    last = min(len(score.measures), selection.end + CONTEXT_MEASURES)

    header = [
        f'Title: "{meta.title}". Piano, grand staff.',
        f"Key: {key_name(score)}. Time: {beats}/{unit} "
        f"({beats} beats of {beat_ticks(meta)} ticks; a bar is {measure_ticks(meta)} ticks). "
        f"Tempo: {meta.tempo} bpm.",
        f"Score length: {len(score.measures)} measures.",
        f"Selection: {selection.describe()}.",
        "",
        "Notes are listed as `id pitch @beat duration`; beats start at 1.",
    ]
    body = []
    for n in range(first, last + 1):
        if selection.start <= n <= selection.end:
            tag = f"SELECTED, editable: {' and '.join(selection.staves)}"
        else:
            tag = "context, read-only"
        body.append(f"--- {tag} ---\n{render_measure(score, n)}")
    return "\n".join(header) + "\n\n" + "\n".join(body)
