import pytest

from app.score.model import Score
from app.score.ops import OpList
from app.scores.summary import Changes, describe, measure_ranges, message


@pytest.mark.parametrize(
    ("measures", "text"),
    [([], ""), ([3], "m. 3"), ([1, 2, 3, 5], "m. 1–3, 5"), ([7, 2, 1], "m. 1–2, 7")],
)
def test_measure_ranges(measures, text):
    assert measure_ranges(measures) == text


def test_message():
    assert message(Changes(kinds=["notes"], measures=[3, 4])) == "Edited notes in m. 3–4"
    assert message(Changes(kinds=["tempo", "notes"], measures=[2])) == (
        "Edited notes in m. 2, changed tempo"
    )
    assert message(Changes(kinds=["title"])) == "Renamed"
    assert message(Changes(kinds=["key", "mode"])) == "Changed key"
    assert message(Changes()) == "No changes"


def test_describe_finds_measures_of_removed_and_moved_notes():
    before = Score.model_validate(
        {
            "measures": [
                {
                    "n": 1,
                    "notes": [{"id": "a", "staff": "RH", "pitch": "C5", "start": 0, "dur": 480}],
                },
                {"n": 2},
                {"n": 3},
            ]
        }
    )
    ops = OpList.validate_python(
        [
            {"op": "update_note", "id": "a", "set": {"measure": 3}},
            {"op": "set_chord", "measure": 2, "chord": "G"},
        ]
    )
    assert describe(before, ops) == Changes(kinds=["chords", "notes"], measures=[1, 2, 3])
