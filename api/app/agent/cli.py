"""Run the edit agent against a score file and print what it did.

From api/:
    .venv/bin/python -m app.agent.cli "Turn the left hand into a walking bass line" \\
        --measures 5-8 --staff LH

Defaults to fixtures/autumn-sketch.json. Needs ANTHROPIC_API_KEY (in api/.env or the env).
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any

import anthropic

from app.agent.context import Selection, render_measure
from app.agent.graph import Proposal, run_agent
from app.agent.model import ClaudeModel
from app.config import get_settings
from app.score.model import Score

DEFAULT_SCORE = Path(__file__).resolve().parents[3] / "fixtures" / "autumn-sketch.json"
# USD per million tokens: input, output, cache read, cache write (5 min).
PRICES = {
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
}


def parse_measures(text: str) -> tuple[int, int]:
    start, _, end = text.partition("-")
    return int(start), int(end or start)


def cost(model: str, usage: dict[str, int]) -> str:
    if model not in PRICES:
        return "n/a"
    p_in, p_out, p_read, p_write = PRICES[model]
    total = (
        usage["input_tokens"] * p_in
        + usage["output_tokens"] * p_out
        + usage["cache_read_tokens"] * p_read
        + usage["cache_write_tokens"] * p_write
    ) / 1_000_000
    return f"${total:.3f}"


def print_result(base: Score, selection: Selection, proposal: Proposal, model: str) -> None:
    print("\n=== Before → after ===")
    for n in range(selection.start, selection.end + 1):
        print(render_measure(base, n))
        print("  ↓")
        print(render_measure(proposal.score, n))
        print()
    if proposal.report:
        print("=== Checks ===")
        print(proposal.report.as_text())
    print("\n=== Summary ===")
    print(proposal.summary or "(none)")
    if proposal.error:
        print(f"\nFAILED: {proposal.error}")
    u = proposal.usage
    print(
        f"\n{proposal.status} · {len(proposal.ops)} ops · {u['turns']} model turns · "
        f"{u['input_tokens']} in / {u['output_tokens']} out / "
        f"{u['cache_read_tokens']} cache read / {u['cache_write_tokens']} cache write tokens · "
        f"≈{cost(model, u)}"
    )


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("instruction")
    parser.add_argument("--score", type=Path, default=DEFAULT_SCORE)
    parser.add_argument("--measures", default="1-4", help="e.g. 5-8 or 3")
    parser.add_argument("--staff", choices=["RH", "LH", "both"], default="both")
    parser.add_argument("--model", default=None)
    parser.add_argument("--effort", default=None, choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--json", type=Path, help="also write the proposal here")
    args = parser.parse_args()

    if not (get_settings().anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")):
        print("Set ANTHROPIC_API_KEY in api/.env (see .env.example) or the environment.")
        return 2

    base = Score.model_validate_json(args.score.read_text())
    start, end = parse_measures(args.measures)
    staves: list[Any] = ["RH", "LH"] if args.staff == "both" else [args.staff]
    selection = Selection(start=start, end=end, staves=staves)
    model = ClaudeModel(model=args.model, effort=args.effort)

    async def show(event: dict[str, Any]) -> None:
        mark = "✓" if event["ok"] else "✗"
        print(f"  {mark} {event['name']}: {event['detail']}")

    print(f"{model.model} (effort {model.effort}) · {selection.describe()} · {args.instruction!r}")
    try:
        proposal = await run_agent(base, selection, args.instruction, model, on_event=show)
    except anthropic.AuthenticationError:
        print("The API key was rejected. Check ANTHROPIC_API_KEY.")
        return 2
    except anthropic.RateLimitError:
        print("Rate limited by the API; try again shortly.")
        return 1
    except anthropic.APIStatusError as err:
        print(f"API error {err.status_code}: {err.message}")
        return 1
    except anthropic.APIConnectionError:
        print("Couldn't reach the Anthropic API.")
        return 1

    print_result(base, selection, proposal, model.model)
    if args.json:
        args.json.write_text(proposal.model_dump_json(indent=2))
        print(f"Wrote {args.json}")
    return 0 if proposal.status == "ready" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
