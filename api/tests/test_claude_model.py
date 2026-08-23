"""ClaudeModel's request shape and response parsing, against SDK types (no network)."""

from types import SimpleNamespace
from typing import Any

from anthropic.types.beta import BetaMessage

from app.agent.model import ClaudeModel
from app.agent.tools import TOOLS


class RecordingMessages:
    def __init__(self, response: BetaMessage):
        self.response = response
        self.kwargs: dict[str, Any] = {}

    async def create(self, **kwargs):
        self.kwargs = kwargs
        return self.response


def fake_client(response: BetaMessage) -> Any:
    messages = RecordingMessages(response)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


RESPONSE = BetaMessage.model_validate(
    {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-5-5",
        "stop_reason": "tool_use",
        "stop_sequence": None,
        "content": [
            {"type": "thinking", "thinking": "", "signature": "sig"},
            {"type": "text", "text": "Writing the bass line."},
            {
                "type": "tool_use",
                "id": "toolu_1",
                "name": "remove_note",
                "input": {"id": "n_m5lh1"},
            },
        ],
        "usage": {
            "input_tokens": 1200,
            "output_tokens": 300,
            "cache_read_input_tokens": 900,
            "cache_creation_input_tokens": 50,
        },
    }
)


async def test_request_and_parsing():
    client, recorder = fake_client(RESPONSE)
    model = ClaudeModel(model="claude-opus-5-5", effort="high", client=client)
    turn = await model.turn("system prompt", [{"role": "user", "content": "hi"}], TOOLS)

    sent = recorder.kwargs
    assert sent["model"] == "claude-opus-5-5"
    assert sent["output_config"] == {"effort": "high"}
    assert "thinking" not in sent  # adaptive by default; can't be disabled on this model
    assert "tool_choice" not in sent  # forced tool choice is rejected; prompt steers instead
    assert all(tool["strict"] for tool in sent["tools"])
    assert sent["fallbacks"] == "default"
    assert sent["betas"] == ["server-side-fallback-2026-07-01"]

    assert turn.text == "Writing the bass line."
    assert [(c.id, c.name, c.input) for c in turn.tool_calls] == [
        ("toolu_1", "remove_note", {"id": "n_m5lh1"})
    ]
    assert turn.stop_reason == "tool_use"
    # Content is passed back verbatim, thinking block included.
    assert [b.type for b in turn.content] == ["thinking", "text", "tool_use"]
    assert (turn.usage.input_tokens, turn.usage.cache_read_tokens) == (1200, 900)
