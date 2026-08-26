"""Tab autocomplete: suggest the next bar for one hand, in a single quick model call.

Unlike the edit agent there's no loop or repair: the model calls `write_bar` once, the notes go
through the same tools (scope, grid, piano range) and checks (rhythm, hand span) as an edit,
and anything that doesn't pass is simply not suggested.
"""

from typing import Any

from pydantic import BaseModel

from app.agent.context import Selection, render_context
from app.agent.model import Model
from app.agent.timing import DURATION_NAMES
from app.agent.tools import Draft, ToolFailure
from app.agent.validate import validate
from app.score.model import Score, Staff

HANDS = {"RH": "right hand (melody, treble staff)", "LH": "left hand (bass staff)"}
MAX_NOTES = 32

WRITE_BAR = {
    "name": "write_bar",
    "description": "Write the suggested notes for the bar. Rests are the gaps between notes.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "notes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "pitch": {"type": "string", "description": "Spelled pitch, e.g. F#3."},
                        "start_beat": {"type": "number", "description": "1-based beat in the bar."},
                        "duration": {"type": "string", "enum": DURATION_NAMES},
                    },
                    "required": ["pitch", "start_beat", "duration"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["notes"],
        "additionalProperties": False,
    },
}

SYSTEM = """\
You are the autocomplete in ChordCraft, a piano score editor. Suggest how one hand continues \
in the next bar, the way a musician would most likely write it: carry on the rhythm, \
register, figuration and voice leading of the bars before it, fit the bar's chord symbol if \
there is one, and keep it playable. Keep it simple; the musician can always change it.

Call write_bar exactly once with the notes. Notes that start together form a chord and share \
one length. Fill the bar unless a rest is clearly more natural.\
"""


class Suggestion(BaseModel):
    ops: list[dict[str, Any]]
    usage: dict[str, int]


async def suggest_bar(score: Score, measure: int, staff: Staff, model: Model) -> Suggestion:
    selection = Selection(start=measure, end=measure, staves=[staff])
    context = render_context(score, selection)
    request = f"{context}\n\nSuggest m{measure} for the {HANDS[staff]}."
    turn = await model.turn(SYSTEM, [{"role": "user", "content": request}], [WRITE_BAR])
    usage = {"input_tokens": turn.usage.input_tokens, "output_tokens": turn.usage.output_tokens}

    call = next((c for c in turn.tool_calls if c.name == "write_bar"), None)
    if call is None or turn.stop_reason in ("refusal", "max_tokens"):
        return Suggestion(ops=[], usage=usage)

    draft = Draft(score=score, selection=selection)
    for note in list(call.input.get("notes", []))[:MAX_NOTES]:
        try:
            draft.add_note(
                measure=measure,
                staff=staff,
                pitch=str(note["pitch"]),
                start_beat=float(note["start_beat"]),
                duration=str(note["duration"]),
            )
        except (ToolFailure, KeyError, TypeError, ValueError):
            continue  # skip a bad note rather than the whole suggestion

    report = validate(score, draft.score, selection)
    if not draft.ops or not report.passed:
        return Suggestion(ops=[], usage=usage)
    return Suggestion(ops=draft.ops, usage=usage)
