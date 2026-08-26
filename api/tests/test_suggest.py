"""Tab autocomplete: /scores/{id}/suggest with a scripted model."""

import json
from pathlib import Path

import pytest
from test_agent import FakeModel, call, turn

from app.main import app
from app.scores.router import get_suggest_model

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SKETCH = json.loads((FIXTURES / "autumn-sketch.json").read_text())
# The sketch plus an empty ninth bar to suggest into.
NINE_BARS = {**SKETCH, "measures": [*SKETCH["measures"], {"n": 9, "notes": []}]}


def bar(*notes: tuple[str, float, str]):
    return turn(
        call("write_bar", notes=[{"pitch": p, "start_beat": b, "duration": d} for p, b, d in notes])
    )


@pytest.fixture
def use_model():
    def install(*script):
        model = FakeModel(list(script))
        app.dependency_overrides[get_suggest_model] = lambda: model
        return model

    yield install
    app.dependency_overrides.pop(get_suggest_model, None)


async def suggest(client, staff="LH", measure=9, base=1):
    score = (await client.post("/scores", json={"score": NINE_BARS})).json()
    res = await client.post(
        f"/scores/{score['id']}/suggest", json={"base": base, "measure": measure, "staff": staff}
    )
    return res


async def test_suggests_a_bar(client, use_model):
    model = use_model(bar(("D3", 1, "quarter"), ("F#3", 2, "quarter"), ("A3", 3, "half")))
    res = await suggest(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["base"] == 1
    added = [(op["note"]["pitch"], op["note"]["start"], op["note"]["dur"]) for op in body["ops"]]
    assert added == [("D3", 0, 480), ("F#3", 480, 480), ("A3", 960, 960)]
    assert all(op["op"] == "add_note" and op["measure"] == 9 for op in body["ops"])
    # The model saw the bars before, and was asked about the right hand and bar.
    prompt = model.seen[0][0]["content"]
    assert "m8 [A7]" in prompt and prompt.endswith("Suggest m9 for the left hand (bass staff).")


async def test_bad_notes_are_dropped(client, use_model):
    use_model(bar(("D3", 1, "half"), ("H9", 3, "half"), ("A3", 3.1, "half"), ("F#3", 3, "half")))
    ops = (await suggest(client)).json()["ops"]
    assert [op["note"]["pitch"] for op in ops] == ["D3", "F#3"]


async def test_a_suggestion_that_breaks_the_rhythm_is_not_offered(client, use_model):
    use_model(bar(("D3", 1, "whole"), ("A3", 2, "quarter")))
    assert (await suggest(client)).json()["ops"] == []


async def test_no_tool_call_means_no_suggestion(client, use_model):
    use_model(turn(text="Not sure what fits here."))
    assert (await suggest(client)).json()["ops"] == []


async def test_model_errors_are_quiet(client, use_model):
    class Broken:
        async def turn(self, *args):
            raise RuntimeError("provider down")

    app.dependency_overrides[get_suggest_model] = lambda: Broken()
    res = await suggest(client)
    assert res.status_code == 200 and res.json()["ops"] == []


async def test_bad_measure_or_version(client, use_model):
    use_model()
    assert (await suggest(client, measure=12)).status_code == 422
    assert (await suggest(client, base=5)).status_code == 404
