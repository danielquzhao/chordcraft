"""The tools the model edits with. Each maps 1:1 to a score op, applied to a draft.

Tool calls are applied immediately so the model gets precise errors back ("m3 is outside the
selection", "that note ends past the barline") and can fix them in the next turn.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from app.agent.context import Selection
from app.agent.timing import (
    DURATION_NAMES,
    beat_to_tick,
    duration_name,
    duration_ticks,
    tick_to_beat,
)
from app.score.model import Note, Score
from app.score.ops import OpError, OpList, apply_ops

PITCH_HELP = "Spelled pitch name such as F#3, Bb4 or C5. Octave 4 starts at middle C."
BEAT_HELP = "1-based beat within the measure; 2.5 is halfway through beat 2. Sixteenth-note grid."


def _schema(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


TOOLS: list[dict[str, Any]] = [
    {
        "name": "add_note",
        "description": "Add one note to the draft inside the selection. Returns the new note's id.",
        "strict": True,
        "input_schema": _schema(
            {
                "measure": {"type": "integer", "description": "Measure number."},
                "staff": {"type": "string", "enum": ["RH", "LH"]},
                "pitch": {"type": "string", "description": PITCH_HELP},
                "start_beat": {"type": "number", "description": BEAT_HELP},
                "duration": {"type": "string", "enum": DURATION_NAMES},
            }
        ),
    },
    {
        "name": "remove_note",
        "description": "Remove a note from the draft by its id.",
        "strict": True,
        "input_schema": _schema({"id": {"type": "string"}}),
    },
    {
        "name": "update_note",
        "description": "Change a note's pitch, start or length. Pass null for anything unchanged.",
        "strict": True,
        "input_schema": _schema(
            {
                "id": {"type": "string"},
                "pitch": {"type": ["string", "null"], "description": PITCH_HELP},
                "start_beat": {"type": ["number", "null"], "description": BEAT_HELP},
                "duration": {"type": ["string", "null"], "enum": [*DURATION_NAMES, None]},
            }
        ),
    },
    {
        "name": "set_chord",
        "description": "Set or clear (null) the chord symbol shown above a selected measure.",
        "strict": True,
        "input_schema": _schema(
            {
                "measure": {"type": "integer"},
                "chord": {"type": ["string", "null"], "description": "e.g. Dmaj7, F#m7b5, G/B"},
            }
        ),
    },
    {
        "name": "submit_edit",
        "description": (
            "Call once the draft is finished. The edit is then checked (rhythm, hand span, "
            "range, voice leading, spelling) and either accepted or returned with problems."
        ),
        "strict": True,
        "input_schema": _schema(
            {
                "summary": {
                    "type": "string",
                    "description": "One or two sentences for the musician on what changed and why.",
                }
            }
        ),
    },
]


class ToolFailure(Exception):
    pass


@dataclass
class Draft:
    """The score being edited plus the ops that produced it from the original."""

    score: Score
    selection: Selection
    ops: list[dict[str, Any]] = field(default_factory=list)

    def _apply(self, op: dict[str, Any]) -> None:
        try:
            self.score = apply_ops(self.score, OpList.validate_python([op]))
        except OpError as err:
            raise ToolFailure(err.message) from None
        except ValidationError as err:
            raise ToolFailure(err.errors()[0]["msg"]) from None
        self.ops.append(op)

    def _find(self, note_id: str) -> tuple[int, Note]:
        for m in self.score.measures:
            for note in m.notes:
                if note.id == note_id:
                    return m.n, note
        raise ToolFailure(f"there is no note with id {note_id}")

    def _check_scope(self, measure: int, staff: str) -> None:
        if not self.selection.contains(measure, staff):
            raise ToolFailure(
                f"m{measure} {staff} is outside the selection ({self.selection.describe()}); "
                "only change notes inside it"
            )

    def _tick(self, beat: float) -> int:
        tick = beat_to_tick(beat, self.score.meta)
        if tick is None:
            raise ToolFailure(f"beat {beat:g} isn't on the sixteenth-note grid")
        return tick

    def _describe(self, measure: int, note: Note) -> str:
        meta = self.score.meta
        return (
            f"{note.id} {note.pitch} at m{measure} {note.staff} beat "
            f"{tick_to_beat(note.start, meta)} ({duration_name(note.dur, meta)})"
        )

    def add_note(
        self, measure: int, staff: str, pitch: str, start_beat: float, duration: str
    ) -> str:
        self._check_scope(measure, staff)
        note = {
            "id": f"n_{uuid.uuid4().hex[:10]}",
            "staff": staff,
            "voice": 1,
            "pitch": pitch,
            "start": self._tick(start_beat),
            "dur": duration_ticks(duration, self.score.meta),
        }
        self._apply({"op": "add_note", "measure": measure, "note": note})
        found = self._find(note["id"])
        return "Added " + self._describe(*found)

    def remove_note(self, id: str) -> str:
        measure, note = self._find(id)
        self._check_scope(measure, note.staff)
        self._apply({"op": "remove_note", "id": id})
        beat = tick_to_beat(note.start, self.score.meta)
        return f"Removed {id} ({note.pitch} at m{measure} beat {beat})"

    def update_note(
        self, id: str, pitch: str | None, start_beat: float | None, duration: str | None
    ) -> str:
        measure, note = self._find(id)
        self._check_scope(measure, note.staff)
        changes: dict[str, Any] = {}
        if pitch is not None:
            changes["pitch"] = pitch
        if start_beat is not None:
            changes["start"] = self._tick(start_beat)
        if duration is not None:
            changes["dur"] = duration_ticks(duration, self.score.meta)
        if not changes:
            raise ToolFailure("nothing to change; pass a pitch, start_beat or duration")
        self._apply({"op": "update_note", "id": id, "set": changes})
        return "Updated " + self._describe(*self._find(id))

    def set_chord(self, measure: int, chord: str | None) -> str:
        if not self.selection.start <= measure <= self.selection.end:
            raise ToolFailure(f"m{measure} is outside the selection ({self.selection.describe()})")
        self._apply({"op": "set_chord", "measure": measure, "chord": chord})
        return f"m{measure} chord is now {chord or 'cleared'}"

    def run(self, name: str, args: dict[str, Any]) -> str:
        """Run one edit tool. Raises ToolFailure with a message for the model."""
        handler = {
            "add_note": self.add_note,
            "remove_note": self.remove_note,
            "update_note": self.update_note,
            "set_chord": self.set_chord,
        }.get(name)
        if handler is None:
            raise ToolFailure(f"unknown tool {name}")
        try:
            return handler(**args)
        except TypeError as err:
            raise ToolFailure(f"bad arguments for {name}: {err}") from None
