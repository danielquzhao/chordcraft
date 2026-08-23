"""The agent graph with a scripted model: no API calls, fully deterministic."""

import json
from collections.abc import Callable
from itertools import count
from pathlib import Path
from typing import Any

import pytest

from app.agent.context import Selection
from app.agent.graph import MAX_REPAIRS, MAX_TURNS, run_agent
from app.agent.model import ModelTurn, ToolCall, Usage
from app.score.model import Score

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SKETCH = Score.model_validate_json((FIXTURES / "autumn-sketch.json").read_text())
LH_5_8 = Selection(start=5, end=8, staves=["LH"])

_ids = count()


def call(name: str, **args: Any) -> ToolCall:
    return ToolCall(id=f"toolu_{next(_ids)}", name=name, input=args)


def turn(*calls: ToolCall, text: str = "", stop: str | None = None) -> ModelTurn:
    content = [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.input} for c in calls]
    if text:
        content.insert(0, {"type": "text", "text": text})
    return ModelTurn(
        content=content,
        tool_calls=list(calls),
        text=text,
        stop_reason=stop or ("tool_use" if calls else "end_turn"),
        usage=Usage(input_tokens=100, output_tokens=20),
    )


Script = list[ModelTurn | Callable[[list[dict[str, Any]]], ModelTurn]]


class FakeModel:
    """Plays back scripted turns; a callable entry can look at the conversation so far."""

    def __init__(self, script: Script):
        self.script = list(script)
        self.seen: list[list[dict[str, Any]]] = []

    async def turn(self, system, messages, tools):
        self.seen.append(json.loads(json.dumps(messages, default=str)))
        step = self.script.pop(0)
        return step(messages) if callable(step) else step


def last_results(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    content = messages[-1]["content"]
    return [b for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]


WALKING = [
    ["D3", "E3", "F#3", "A3"],
    ["B2", "C#3", "D3", "F#3"],
    ["E3", "G3", "F#3", "D3"],
    ["A2", "C#3", "E3", "G3"],
]


def walking_bass_calls() -> list[ToolCall]:
    calls = [call("remove_note", id=f"n_m{m}lh1") for m in range(5, 9)]
    for i, bar in enumerate(WALKING):
        for beat, pitch in enumerate(bar, start=1):
            calls.append(
                call(
                    "add_note",
                    measure=5 + i,
                    staff="LH",
                    pitch=pitch,
                    start_beat=beat,
                    duration="quarter",
                )
            )
    return calls


def lh(score: Score, n: int) -> list[str]:
    return [x.pitch for x in score.measures[n - 1].notes if x.staff == "LH"]


async def test_walking_bass_edit():
    events: list[dict[str, Any]] = []

    async def sink(event):
        events.append(event)

    model = FakeModel(
        [
            turn(*walking_bass_calls()),
            turn(call("submit_edit", summary="Walking quarter-note bass through m. 5–8.")),
        ]
    )
    proposal = await run_agent(
        SKETCH, LH_5_8, "Turn the left hand into a walking bass line", model, sink
    )

    assert proposal.status == "ready"
    assert proposal.summary == "Walking quarter-note bass through m. 5–8."
    assert proposal.report is not None and proposal.report.passed
    assert len(proposal.ops) == 20
    assert [lh(proposal.score, n) for n in range(5, 9)] == WALKING
    # The melody and the measures outside the selection are untouched.
    assert proposal.score.measures[:4] == SKETCH.measures[:4]
    assert [x for x in proposal.score.measures[4].notes if x.staff == "RH"] == [
        x for x in SKETCH.measures[4].notes if x.staff == "RH"
    ]
    names = [s.name for s in proposal.steps]
    assert names[0] == "read_score" and names[-1] == "validate"
    assert [e["name"] for e in events] == names
    assert proposal.usage["turns"] == 2


async def test_out_of_scope_edits_are_rejected_and_fixed():
    def second(messages):
        result = last_results(messages)[0]
        assert result["is_error"] and "outside the selection" in result["content"]
        return turn(call("update_note", id="n_m5lh1", pitch="F#2", start_beat=None, duration=None))

    model = FakeModel(
        [
            turn(call("update_note", id="n_m5rh1", pitch="B4", start_beat=None, duration=None)),
            second,
            turn(call("submit_edit", summary="Moved the bass to F#.")),
        ]
    )
    proposal = await run_agent(SKETCH, LH_5_8, "Change the bass", model)
    assert proposal.status == "ready"
    assert lh(proposal.score, 5) == ["F#2"]
    assert len(proposal.ops) == 1  # the rejected call left no op behind
    assert [s.ok for s in proposal.steps if s.name == "update_note"] == [False, True]


async def test_failed_checks_go_back_for_repair():
    def repair(messages):
        submit = last_results(messages)[-1]
        assert submit["is_error"] and "wider than a tenth" in submit["content"]
        added = next(
            b
            for m in messages
            if m["role"] == "user" and isinstance(m["content"], list)
            for b in m["content"]
            if "Added" in str(b.get("content", ""))
        )
        new_id = added["content"].split()[1]
        return turn(
            call("update_note", id=new_id, pitch="A2", start_beat=None, duration=None),
            call("submit_edit", summary="Added an open fifth under the D."),
        )

    model = FakeModel(
        [
            # D3 with an A4 on top: a 19-semitone stretch.
            turn(
                call("add_note", measure=5, staff="LH", pitch="A4", start_beat=1, duration="whole"),
                call("submit_edit", summary="Added a fifth."),
            ),
            repair,
        ]
    )
    proposal = await run_agent(SKETCH, LH_5_8, "Thicken the bass in m. 5", model)
    assert proposal.status == "ready" and proposal.report is not None and proposal.report.passed
    assert sorted(lh(proposal.score, 5)) == ["A2", "D3"]
    assert [s.ok for s in proposal.steps if s.name == "validate"] == [False, True]


async def test_gives_up_repairing_after_the_limit():
    bad = turn(
        call("add_note", measure=5, staff="LH", pitch="A4", start_beat=1, duration="whole"),
        call("submit_edit", summary="Wide."),
    )
    resubmit = [turn(call("submit_edit", summary="Still wide.")) for _ in range(MAX_REPAIRS)]
    proposal = await run_agent(SKETCH, LH_5_8, "Wide chord", FakeModel([bad, *resubmit]))
    # Still returned so the musician can see it, with the failure in the report.
    assert proposal.status == "ready"
    assert proposal.report is not None and not proposal.report.passed
    assert proposal.ops


async def test_prose_answer_is_nudged_once_then_accepted():
    model = FakeModel(
        [
            turn(text="Which instrument should carry the line?"),
            turn(text="The selection has no notes I can change for that request."),
        ]
    )
    proposal = await run_agent(SKETCH, LH_5_8, "Give it to the oboe", model)
    assert proposal.status == "ready"
    assert proposal.ops == []
    assert "no notes I can change" in proposal.summary
    assert model.seen[1][-1] == {
        "role": "user",
        "content": "Make the change with the editing tools, then call submit_edit.",
    }


async def test_refusal_fails_the_run():
    proposal = await run_agent(SKETCH, LH_5_8, "x", FakeModel([turn(stop="refusal")]))
    assert proposal.status == "failed"
    assert proposal.ops == [] and proposal.score == SKETCH
    assert proposal.error == "Claude declined this request."


async def test_runs_out_of_turns():
    noop = [turn(call("set_chord", measure=5, chord="D")) for _ in range(MAX_TURNS)]
    proposal = await run_agent(SKETCH, LH_5_8, "loop", FakeModel(noop))
    assert proposal.status == "failed"
    assert "ran out of turns" in (proposal.error or "")


async def test_selection_must_fit_the_score():
    with pytest.raises(ValueError):
        await run_agent(SKETCH, Selection(start=7, end=12), "x", FakeModel([]))
