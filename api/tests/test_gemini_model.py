"""GeminiModel against google-genai's real types with a fake client (no network)."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from google.genai import types

from app.agent.context import Selection
from app.agent.gemini import GeminiModel
from app.agent.graph import run_agent
from app.agent.model import ClaudeModel, make_model
from app.agent.tools import TOOLS
from app.score.model import Score

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SKETCH = Score.model_validate_json((FIXTURES / "autumn-sketch.json").read_text())


def reply(*parts: types.Part, finish: str = "STOP") -> types.GenerateContentResponse:
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                content=types.Content(role="model", parts=list(parts)),
                finish_reason=types.FinishReason(finish),
            )
        ],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=1000,
            cached_content_token_count=400,
            candidates_token_count=150,
            thoughts_token_count=50,
        ),
    )


def fn(name: str, **args: Any) -> types.Part:
    return types.Part(function_call=types.FunctionCall(name=name, args=args))


class FakeModels:
    def __init__(self, script: list[types.GenerateContentResponse]):
        self.script = list(script)
        self.requests: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs):
        self.requests.append(kwargs)
        return self.script.pop(0)


def fake_client(script):
    models = FakeModels(script)
    return SimpleNamespace(aio=SimpleNamespace(models=models)), models


async def test_request_shape_and_parsing():
    client, models = fake_client(
        [
            reply(
                types.Part(text="Planning the bass…", thought=True),
                types.Part(text="Removing the whole note."),
                fn("remove_note", id="n_m5lh1"),
            )
        ]
    )
    model = GeminiModel("gemini-3-flash", effort="medium", client=client)
    turn = await model.turn("system", [{"role": "user", "content": "hi"}], TOOLS)

    config: types.GenerateContentConfig = models.requests[0]["config"]
    declarations = config.tools[0].function_declarations
    assert [d.name for d in declarations] == [t["name"] for t in TOOLS]
    assert declarations[0].parameters_json_schema == TOOLS[0]["input_schema"]
    assert config.tool_config.function_calling_config.mode == types.FunctionCallingConfigMode.AUTO
    assert config.automatic_function_calling.disable is True
    assert config.thinking_config.thinking_level == types.ThinkingLevel.MEDIUM
    assert config.system_instruction == "system"

    assert turn.text == "Removing the whole note."  # thoughts are not part of the reply text
    assert [(c.name, c.input) for c in turn.tool_calls] == [("remove_note", {"id": "n_m5lh1"})]
    assert turn.stop_reason == "tool_use"
    assert (turn.usage.input_tokens, turn.usage.cache_read_tokens, turn.usage.output_tokens) == (
        600,
        400,
        200,
    )


def test_gemini_2_uses_a_thinking_budget():
    model = GeminiModel("gemini-2.5-flash", effort="high", client=SimpleNamespace())
    from app.agent.gemini import thinking_config

    assert thinking_config(model.model, model.effort).thinking_budget == -1


async def test_full_agent_run_through_gemini():
    signature = b"opaque-thought-signature"
    first = reply(
        types.Part(
            function_call=types.FunctionCall(id="g1", name="remove_note", args={"id": "n_m8lh1"}),
            thought_signature=signature,
        ),
        types.Part(
            function_call=types.FunctionCall(
                id="g2",
                name="add_note",
                args={
                    "measure": 3,
                    "staff": "LH",
                    "pitch": "A2",
                    "start_beat": 1,
                    "duration": "whole",
                },
            )
        ),
    )
    second = reply(
        fn("add_note", measure=8, staff="LH", pitch="A2", start_beat=1, duration="half"),
        fn("add_note", measure=8, staff="LH", pitch="E3", start_beat=3, duration="half"),
    )
    third = reply(fn("submit_edit", summary="Split the last bass note into two halves."))
    client, models = fake_client([first, second, third])

    proposal = await run_agent(
        SKETCH,
        Selection(start=8, end=8, staves=["LH"]),
        "Move the bass in bar 8",
        GeminiModel("gemini-3-flash", client=client),
    )
    assert proposal.status == "ready"
    assert [x.pitch for x in proposal.score.measures[7].notes if x.staff == "LH"] == ["A2", "E3"]

    # Second request: the model's first reply goes back verbatim (thought signature intact),
    # followed by one function response per call, matched by name and Gemini's ids.
    contents: list[types.Content] = models.requests[1]["contents"]
    assert [c.role for c in contents] == ["user", "model", "user"]
    assert contents[1].parts[0].thought_signature == signature
    responses = [p.function_response for p in contents[2].parts]
    assert [(r.id, r.name) for r in responses] == [("g1", "remove_note"), ("g2", "add_note")]
    assert "result" in responses[0].response
    assert "outside the selection" in responses[1].response["error"]


async def test_blocked_prompt_is_a_refusal():
    blocked = types.GenerateContentResponse(
        candidates=[],
        prompt_feedback=types.GenerateContentResponsePromptFeedback(
            block_reason=types.BlockedReason.SAFETY
        ),
    )
    client, _ = fake_client([blocked])
    proposal = await run_agent(
        SKETCH, Selection(start=1, end=1), "x", GeminiModel("gemini-3-flash", client=client)
    )
    assert proposal.status == "failed"
    assert proposal.error == "The model declined this request."


def test_make_model_picks_the_provider(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")  # the Gemini client needs a key to construct
    assert isinstance(make_model("gemini-3-flash"), GeminiModel)
    assert isinstance(make_model("claude-sonnet-5-5"), ClaudeModel)
