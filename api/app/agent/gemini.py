"""Gemini behind the agent's Model interface, via Google's google-genai SDK.

The graph keeps its conversation in one shape (Anthropic-style messages with tool_use and
tool_result blocks). This adapter translates that history into Gemini contents on every call,
and Gemini's replies back into ModelTurns. The model's own reply content is kept as returned
and sent back unchanged, so thought signatures survive between turns.
"""

import uuid
from typing import Any

from google import genai
from google.genai import types

from app.agent.model import ModelTurn, ToolCall, Usage
from app.config import get_settings

REFUSALS = {
    types.FinishReason.SAFETY,
    types.FinishReason.PROHIBITED_CONTENT,
    types.FinishReason.BLOCKLIST,
    types.FinishReason.SPII,
    types.FinishReason.RECITATION,
}
THINKING_LEVELS = {
    "low": types.ThinkingLevel.LOW,
    "medium": types.ThinkingLevel.MEDIUM,
    "high": types.ThinkingLevel.HIGH,
    "xhigh": types.ThinkingLevel.HIGH,
    "max": types.ThinkingLevel.HIGH,
}


def function_declarations(tools: list[dict[str, Any]]) -> list[types.FunctionDeclaration]:
    """Our tool definitions as Gemini function declarations (JSON Schema passes through)."""
    return [
        types.FunctionDeclaration(
            name=tool["name"],
            description=tool["description"],
            parameters_json_schema=tool["input_schema"],
        )
        for tool in tools
    ]


def thinking_config(model: str, effort: str) -> types.ThinkingConfig:
    # Gemini 2.x sizes thinking with a token budget (-1 lets the model decide);
    # later models take a thinking level, which maps onto our effort setting.
    if model.startswith("gemini-2"):
        return types.ThinkingConfig(thinking_budget=-1)
    return types.ThinkingConfig(
        thinking_level=THINKING_LEVELS.get(effort, types.ThinkingLevel.HIGH)
    )


class GeminiModel:
    def __init__(
        self,
        model: str,
        effort: str | None = None,
        client: genai.Client | None = None,
    ):
        settings = get_settings()
        self.model = model
        self.effort = effort or settings.agent_effort
        self.client = client or genai.Client(api_key=settings.gemini_api_key or None)
        # Our tool_use ids → (function name, Gemini's own call id, which may be None).
        self._calls: dict[str, tuple[str, str | None]] = {}

    def _contents(self, messages: list[dict[str, Any]]) -> list[types.Content]:
        contents: list[types.Content] = []
        for message in messages:
            content = message["content"]
            if message["role"] == "assistant":
                # Gemini's reply, stored verbatim by turn().
                contents.extend(c for c in content if isinstance(c, types.Content))
            elif isinstance(content, str):
                contents.append(types.Content(role="user", parts=[types.Part(text=content)]))
            else:
                parts = []
                for block in content:
                    name, gemini_id = self._calls[block["tool_use_id"]]
                    key = "error" if block.get("is_error") else "result"
                    parts.append(
                        types.Part(
                            function_response=types.FunctionResponse(
                                id=gemini_id, name=name, response={key: block["content"]}
                            )
                        )
                    )
                contents.append(types.Content(role="user", parts=parts))
        return contents

    async def turn(
        self, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> ModelTurn:
        response = await self.client.aio.models.generate_content(
            model=self.model,
            contents=self._contents(messages),  # type: ignore[arg-type]
            config=types.GenerateContentConfig(
                system_instruction=system,
                tools=[types.Tool(function_declarations=function_declarations(tools))],
                tool_config=types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(
                        mode=types.FunctionCallingConfigMode.AUTO
                    )
                ),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                thinking_config=thinking_config(self.model, self.effort),
                max_output_tokens=16000,
            ),
        )

        usage = response.usage_metadata
        cached = (usage.cached_content_token_count or 0) if usage else 0
        turn_usage = Usage(
            input_tokens=((usage.prompt_token_count or 0) - cached) if usage else 0,
            output_tokens=(
                (usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0)
                if usage
                else 0
            ),
            cache_read_tokens=cached,
        )

        if not response.candidates or response.candidates[0].content is None:
            # Blocked before any output (prompt_feedback carries the reason).
            return ModelTurn(
                content=[], tool_calls=[], text="", stop_reason="refusal", usage=turn_usage
            )

        candidate = response.candidates[0]
        reply = candidate.content
        assert reply is not None
        calls: list[ToolCall] = []
        texts: list[str] = []
        for part in reply.parts or []:
            if part.function_call is not None:
                fc = part.function_call
                our_id = f"call_{uuid.uuid4().hex[:12]}"
                self._calls[our_id] = (fc.name or "", fc.id)
                calls.append(ToolCall(id=our_id, name=fc.name or "", input=dict(fc.args or {})))
            elif part.text and not part.thought:
                texts.append(part.text)

        if candidate.finish_reason in REFUSALS:
            stop = "refusal"
        elif candidate.finish_reason == types.FinishReason.MAX_TOKENS:
            stop = "max_tokens"
        else:
            stop = "tool_use" if calls else "end_turn"

        return ModelTurn(
            content=[reply],
            tool_calls=calls,
            text="\n".join(texts).strip(),
            stop_reason=stop,
            usage=turn_usage,
        )
