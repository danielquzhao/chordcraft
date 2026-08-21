import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.score.model import Meta, Score, measure_ticks

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def test_fixture_score_round_trips():
    raw = json.loads((FIXTURES / "autumn-sketch.json").read_text())
    score = Score.model_validate(raw)
    assert score.meta.key == "D"
    assert len(score.measures) == 8
    assert score.model_dump(mode="json") == raw


@pytest.mark.parametrize(
    ("time", "ticks"), [((4, 4), 1920), ((3, 4), 1440), ((6, 8), 1440), ((2, 2), 1920)]
)
def test_measure_ticks(time, ticks):
    assert measure_ticks(Meta(time=time)) == ticks


def test_rejects_bad_pitch():
    with pytest.raises(ValidationError):
        Score.model_validate(
            {
                "measures": [
                    {
                        "n": 1,
                        "notes": [
                            {"id": "x", "staff": "RH", "pitch": "H4", "start": 0, "dur": 480}
                        ],
                    }
                ]
            }
        )


def test_rejects_unknown_fields_and_keys():
    with pytest.raises(ValidationError):
        Meta(key="Fb")
    with pytest.raises(ValidationError):
        Meta(time=(4, 3))
    with pytest.raises(ValidationError):
        Meta.model_validate({"bogus": 1})
