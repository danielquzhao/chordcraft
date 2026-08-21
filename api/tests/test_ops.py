import json
from pathlib import Path

import pytest

from app.score.model import Score
from app.score.ops import OpError, OpList, apply_ops
from scripts.gen_ops_cases import FIXTURE, build

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
def sketch() -> Score:
    return Score.model_validate_json((FIXTURES / "autumn-sketch.json").read_text())


def ops(*raw):
    return OpList.validate_python(list(raw))


def test_walking_bass_edit(sketch):
    # The edit from the design mockup: whole-note roots in m. 5-8 become a walking line.
    removed = [n.id for m in sketch.measures[4:8] for n in m.notes if n.staff == "LH"]
    line = ["D3", "E3", "F#3", "A3", "B2", "C#3", "D3", "F#3",
            "E3", "G3", "F#3", "D3", "A2", "C#3", "E3", "G3"]  # fmt: skip
    edit = [{"op": "remove_note", "id": i} for i in removed] + [
        {
            "op": "add_note",
            "measure": 5 + k // 4,
            "note": {"id": f"w{k}", "staff": "LH", "pitch": p, "start": (k % 4) * 480, "dur": 480},
        }
        for k, p in enumerate(line)
    ]
    result = apply_ops(sketch, ops(*edit))

    bass = [[n.pitch for n in m.notes if n.staff == "LH"] for m in result.measures[4:8]]
    assert bass == [line[0:4], line[4:8], line[8:12], line[12:16]]
    # Untouched measures and the melody are unchanged.
    assert result.measures[:4] == sketch.measures[:4]
    assert [n for n in result.measures[4].notes if n.staff == "RH"] == [
        n for n in sketch.measures[4].notes if n.staff == "RH"
    ]


def test_input_score_is_not_mutated(sketch):
    before = sketch.model_dump()
    with pytest.raises(OpError):
        apply_ops(sketch, ops({"op": "set_chord", "measure": 1, "chord": "X"},
                              {"op": "remove_note", "id": "nope"}))  # fmt: skip
    apply_ops(sketch, ops({"op": "delete_measures", "at": 1, "count": 3}))
    assert sketch.model_dump() == before


def test_error_carries_index_and_code(sketch):
    with pytest.raises(OpError) as info:
        apply_ops(sketch, ops({"op": "set_chord", "measure": 1, "chord": "D6"},
                              {"op": "set_chord", "measure": 99, "chord": "D6"}))  # fmt: skip
    assert (info.value.index, info.value.code) == (1, "measure_not_found")


def test_shared_cases_fixture_is_current():
    """fixtures/ops_cases.json must match what apply_ops produces today.

    If this fails after an intentional change, regenerate with
    `.venv/bin/python -m scripts.gen_ops_cases` and check the diff.
    """
    assert json.loads(FIXTURE.read_text()) == build()
