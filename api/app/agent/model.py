"""The model behind the agent, behind a small interface so tests can script it.

Providers: Claude (this module) and Gemini (app/agent/gemini.py). make_model picks one
from the model name.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol

import anthropic

from app.config import get_settings


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def add(self, other: "Usage") -> "Usage":
        return Usage(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
            self.cache_read_tokens + other.cache_read_tokens,
            self.cache_write_tokens + other.cache_write_tokens,
        )


@dataclass
class ModelTurn:
    # The assistant content exactly as returned, appended to the history unchanged
    # (thinking blocks must be passed back as-is).
    content: list[Any]
    tool_calls: list[ToolCall]
    text: str
    stop_reason: str
    usage: Usage = field(default_factory=Usage)


class Model(Protocol):
    async def turn(
        self, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> ModelTurn: ...


class ClaudeModel:
    """Claude via the Anthropic SDK.

    Thinking is adaptive (always on for this model); `effort` sets how hard it works.
    Server-side refusal fallback is on, so a declined request is retried on another
    model within the same call.
    """

    def __init__(
        self,
        model: str | None = None,
        effort: str | None = None,
        client: anthropic.AsyncAnthropic | None = None,
    ):
        settings = get_settings()
        self.model = model or settings.agent_model
        self.effort = effort or settings.agent_effort
        self.client = client or anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)

    async def turn(
        self, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> ModelTurn:
        response = await self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            system=system,
            messages=messages,  # type: ignore[arg-type]
            tools=tools,  # type: ignore[arg-type]
            output_config={"effort": self.effort},  # type: ignore[typeddict-item]
            cache_control={"type": "ephemeral"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        calls = [
            ToolCall(id=b.id, name=b.name, input=dict(b.input))
            for b in response.content
            if b.type == "tool_use"
        ]
        text = "\n".join(b.text for b in response.content if b.type == "text").strip()
        u = response.usage
        return ModelTurn(
            content=list(response.content),
            tool_calls=calls,
            text=text,
            stop_reason=response.stop_reason or "end_turn",
            usage=Usage(
                input_tokens=u.input_tokens,
                output_tokens=u.output_tokens,
                cache_read_tokens=u.cache_read_input_tokens or 0,
                cache_write_tokens=u.cache_creation_input_tokens or 0,
            ),
        )


def make_model(name: str | None = None, effort: str | None = None) -> Model:
    """gemini-* models go to Gemini; everything else to Claude."""
    name = name or get_settings().agent_model
    if name.startswith("gemini-"):
        from app.agent.gemini import GeminiModel  # imported here to avoid a circular import

        return GeminiModel(name, effort)
    return ClaudeModel(name, effort)
