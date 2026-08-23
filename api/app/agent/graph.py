"""The edit agent as a LangGraph state machine.

    context → model ⇄ tools → validate ─pass─▶ done
                 ▲                │ fail (up to MAX_REPAIRS)
                 └────────────────┘

The model edits a draft through tool calls (app/agent/tools.py). When it submits, the
deterministic validator (app/agent/validate.py) checks the draft; failures go back to the
model as the submit_edit tool result so it can repair them.
"""

from collections.abc import Awaitable, Callable
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel

from app.agent import prompts
from app.agent.context import Selection, render_context
from app.agent.model import Model, ToolCall, Usage
from app.agent.tools import TOOLS, Draft, ToolFailure
from app.agent.validate import Report, validate
from app.score.model import Score

MAX_TURNS = 12
MAX_REPAIRS = 2


class Step(BaseModel):
    """One line in the agent panel's step list."""

    name: str
    detail: str
    ok: bool = True


class Proposal(BaseModel):
    status: Literal["ready", "failed"]
    ops: list[dict[str, Any]]
    summary: str
    report: Report | None
    steps: list[Step]
    score: Score
    usage: dict[str, int]
    error: str | None = None


EventSink = Callable[[dict[str, Any]], Awaitable[None]]


class State(TypedDict, total=False):
    base: Score
    selection: Selection
    instruction: str
    draft: Draft
    messages: list[dict[str, Any]]
    pending: list[ToolCall]
    results: list[dict[str, Any]]
    submitted: str | None
    report: Report | None
    steps: list[Step]
    turns: int
    repairs: int
    nudged: bool
    usage: Usage
    text: str
    outcome: Literal["running", "ready", "failed"]
    error: str | None


def build_graph(model: Model, on_event: EventSink | None = None):
    async def emit(step: Step) -> None:
        if on_event:
            await on_event({"type": "step", **step.model_dump()})

    async def context(state: State) -> State:
        selection = state["selection"]
        text = render_context(state["base"], selection)
        step = Step(name="read_score", detail=selection.describe())
        await emit(step)
        return {
            "draft": Draft(score=state["base"], selection=selection),
            "messages": [
                {"role": "user", "content": prompts.user_message(text, state["instruction"])}
            ],
            "steps": [step],
            "turns": 0,
            "repairs": 0,
            "nudged": False,
            "usage": Usage(),
            "outcome": "running",
            "submitted": None,
            "report": None,
        }

    async def call_model(state: State) -> State:
        turn = await model.turn(prompts.SYSTEM, state["messages"], TOOLS)
        update: State = {
            "messages": [*state["messages"], {"role": "assistant", "content": turn.content}],
            "pending": turn.tool_calls,
            "turns": state["turns"] + 1,
            "usage": state["usage"].add(turn.usage),
            "text": turn.text or state.get("text", ""),
        }
        if turn.stop_reason == "refusal":
            update |= {"outcome": "failed", "error": "Claude declined this request."}
        elif turn.stop_reason == "max_tokens":
            update |= {"outcome": "failed", "error": "The response was cut off before finishing."}
        return update

    async def run_tools(state: State) -> State:
        draft = state["draft"]
        results: list[dict[str, Any]] = []
        submitted: str | None = None
        steps = list(state["steps"])
        for call in state["pending"]:
            if call.name == "submit_edit":
                # Answered after validation; it decides what the model hears back.
                submitted = str(call.input.get("summary", "")).strip()
                continue
            try:
                message, is_error = draft.run(call.name, call.input), False
            except ToolFailure as err:
                message, is_error = f"Error: {err}", True
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": message,
                    "is_error": is_error,
                }
            )
            step = Step(name=call.name, detail=message, ok=not is_error)
            steps.append(step)
            await emit(step)

        update: State = {"draft": draft, "results": results, "steps": steps}
        if submitted is not None:
            update["submitted"] = submitted
        else:
            update["messages"] = [*state["messages"], {"role": "user", "content": results}]
            if state["turns"] >= MAX_TURNS:
                update |= {
                    "outcome": "failed",
                    "error": "The agent ran out of turns before finishing.",
                }
        return update

    async def check(state: State) -> State:
        report = validate(state["base"], state["draft"].score, state["selection"])
        submit_id = next(c.id for c in state["pending"] if c.name == "submit_edit")
        n_ok = sum(c.status != "fail" for c in report.checks)
        step = Step(
            name="validate",
            detail=f"{n_ok}/{len(report.checks)} checks passed",
            ok=report.passed,
        )
        await emit(step)
        steps = [*state["steps"], step]

        if report.passed or state["repairs"] >= MAX_REPAIRS:
            reply = "Accepted." if report.passed else "Submitted with unresolved problems."
            done: State = {
                "report": report,
                "steps": steps,
                "outcome": "ready",
                "messages": [
                    *state["messages"],
                    {
                        "role": "user",
                        "content": [
                            *state["results"],
                            {"type": "tool_result", "tool_use_id": submit_id, "content": reply},
                        ],
                    },
                ],
            }
            return done
        return {
            "report": report,
            "steps": steps,
            "repairs": state["repairs"] + 1,
            "submitted": None,
            "messages": [
                *state["messages"],
                {
                    "role": "user",
                    "content": [
                        *state["results"],
                        {
                            "type": "tool_result",
                            "tool_use_id": submit_id,
                            "content": prompts.repair_message(report.as_text()),
                            "is_error": True,
                        },
                    ],
                },
            ],
        }

    async def nudge(state: State) -> State:
        """The model answered in prose. Ask once for tool use; after that, take the answer."""
        if state["nudged"] or state["draft"].ops:
            return {"outcome": "ready", "submitted": state.get("text", "")}
        return {
            "nudged": True,
            "messages": [*state["messages"], {"role": "user", "content": prompts.NUDGE}],
        }

    def after_model(state: State) -> str:
        if state["outcome"] == "failed":
            return END
        return "tools" if state["pending"] else "nudge"

    def after_tools(state: State) -> str:
        if state.get("outcome") == "failed":
            return END
        return "validate" if state.get("submitted") is not None else "model"

    def after_check(state: State) -> str:
        return END if state["outcome"] == "ready" else "model"

    def after_nudge(state: State) -> str:
        return END if state["outcome"] == "ready" else "model"

    graph = StateGraph(State)
    graph.add_node("context", context)
    graph.add_node("model", call_model)
    graph.add_node("tools", run_tools)
    graph.add_node("validate", check)
    graph.add_node("nudge", nudge)
    graph.add_edge(START, "context")
    graph.add_edge("context", "model")
    graph.add_conditional_edges("model", after_model, ["tools", "nudge", END])
    graph.add_conditional_edges("tools", after_tools, ["validate", "model", END])
    graph.add_conditional_edges("validate", after_check, ["model", END])
    graph.add_conditional_edges("nudge", after_nudge, ["model", END])
    return graph.compile()


async def run_agent(
    base: Score,
    selection: Selection,
    instruction: str,
    model: Model,
    on_event: EventSink | None = None,
) -> Proposal:
    """Run the agent and return a proposal: the ops, the validation report, and a summary."""
    if selection.end > len(base.measures):
        raise ValueError(
            f"selection ends at m{selection.end}, but the score has {len(base.measures)}"
        )
    graph = build_graph(model, on_event)
    # Each turn passes through a few nodes; leave headroom over MAX_TURNS.
    final: State = await graph.ainvoke(
        {"base": base, "selection": selection, "instruction": instruction},
        {"recursion_limit": MAX_TURNS * 4 + 10},
    )
    usage = final["usage"]
    draft = final["draft"]
    failed = final["outcome"] == "failed"
    return Proposal(
        status="failed" if failed else "ready",
        ops=[] if failed else draft.ops,
        summary=final.get("submitted") or final.get("text", ""),
        report=final.get("report"),
        steps=final["steps"],
        score=base if failed else draft.score,
        usage={
            "turns": final["turns"],
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cache_read_tokens": usage.cache_read_tokens,
            "cache_write_tokens": usage.cache_write_tokens,
        },
        error=final.get("error"),
    )
