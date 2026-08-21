"""The score model shared by rendering, diffs, agent tools, and versioning.

See docs/PLAN.md ("Score model"). Mirrored in web/src/score/types.ts.
"""

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.score.pitch import MAJOR_KEYS, MINOR_KEYS, is_valid_pitch, to_midi

Staff = Literal["RH", "LH"]
Mode = Literal["major", "minor"]

STAFF_ORDER = {"RH": 0, "LH": 1}
DENOMINATORS = {1, 2, 4, 8, 16}


def _check_pitch(value: str) -> str:
    if not is_valid_pitch(value):
        raise ValueError(f"invalid pitch {value!r}; expected a name like 'F#3' or 'Bb4'")
    return value


PitchName = Annotated[str, AfterValidator(_check_pitch)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Note(_Strict):
    id: str = Field(min_length=1, max_length=64)
    staff: Staff
    voice: int = Field(default=1, ge=1, le=4)
    pitch: PitchName
    start: int = Field(ge=0)
    dur: int = Field(gt=0)
    tie: bool = False


class Measure(_Strict):
    n: int = Field(ge=1)
    chord: str | None = None
    section: str | None = None
    notes: list[Note] = Field(default_factory=list)


class Meta(_Strict):
    title: str = Field(default="Untitled score", max_length=200)
    key: str = "C"
    mode: Mode = "major"
    time: tuple[int, int] = (4, 4)
    tempo: int = Field(default=92, ge=20, le=400)
    ppq: int = Field(default=480, gt=0)

    @model_validator(mode="after")
    def _check(self) -> "Meta":
        keys = MAJOR_KEYS if self.mode == "major" else MINOR_KEYS
        if self.key not in keys:
            raise ValueError(f"unknown {self.mode} key {self.key!r}")
        beats, unit = self.time
        if not 1 <= beats <= 32 or unit not in DENOMINATORS:
            raise ValueError(f"unsupported time signature {beats}/{unit}")
        return self


class Score(_Strict):
    meta: Meta = Field(default_factory=Meta)
    measures: list[Measure] = Field(min_length=1)


def measure_ticks(meta: Meta) -> int:
    beats, unit = meta.time
    return beats * meta.ppq * 4 // unit


def note_sort_key(note: Note) -> tuple[int, int, int, int, str]:
    return (STAFF_ORDER[note.staff], note.voice, note.start, to_midi(note.pitch), note.id)
