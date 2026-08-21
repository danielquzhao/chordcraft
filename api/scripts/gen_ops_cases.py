"""Regenerate fixtures/ops_cases.json from the Python apply_ops.

The file holds a base score plus cases (ops in, expected score or error out). Python and
TypeScript tests both run it, which keeps the two implementations identical.

Run from api/:  .venv/bin/python -m scripts.gen_ops_cases
"""

import json
from pathlib import Path
from typing import Any

from app.score.model import Score
from app.score.ops import OpError, OpList, apply_ops

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "ops_cases.json"


def note(id: str, staff: str, pitch: str, start: int, dur: int, **extra: Any) -> dict[str, Any]:
    return {
        "id": id,
        "staff": staff,
        "voice": 1,
        "pitch": pitch,
        "start": start,
        "dur": dur,
        **extra,
    }


BASE: dict[str, Any] = {
    "meta": {
        "title": "Base",
        "key": "G",
        "mode": "major",
        "time": [4, 4],
        "tempo": 100,
        "ppq": 480,
    },
    "measures": [
        {
            "n": 1,
            "chord": "G",
            "section": None,
            "notes": [
                note("a1", "RH", "B4", 0, 480),
                note("a2", "RH", "D5", 480, 480),
                note("a3", "LH", "G3", 0, 960),
            ],
        },
        {
            "n": 2,
            "chord": "D",
            "section": None,
            "notes": [note("b1", "RH", "A4", 0, 960), note("b2", "LH", "D3", 0, 1920)],
        },
    ],
}

CASES: list[tuple[str, list[dict[str, Any]]]] = [
    (
        "add a note; notes stay sorted",
        [
            {"op": "add_note", "measure": 1, "note": note("x1", "RH", "F#5", 960, 480)},
            {"op": "add_note", "measure": 1, "note": note("x2", "LH", "B2", 960, 960)},
        ],
    ),
    (
        "add a chord tone at the same start sorts by pitch",
        [
            {"op": "add_note", "measure": 1, "note": note("x1", "RH", "G4", 0, 480)},
        ],
    ),
    (
        "add with an existing id fails",
        [
            {"op": "add_note", "measure": 2, "note": note("a1", "RH", "C5", 960, 480)},
        ],
    ),
    (
        "add past the end of the measure fails",
        [
            {"op": "add_note", "measure": 1, "note": note("x1", "RH", "C5", 1440, 960)},
        ],
    ),
    (
        "add outside the piano range fails",
        [
            {"op": "add_note", "measure": 1, "note": note("x1", "LH", "G0", 960, 480)},
        ],
    ),
    (
        "add to a missing measure fails",
        [
            {"op": "add_note", "measure": 9, "note": note("x1", "RH", "C5", 0, 480)},
        ],
    ),
    ("remove a note", [{"op": "remove_note", "id": "a2"}]),
    ("remove a missing note fails", [{"op": "remove_note", "id": "zz"}]),
    (
        "update pitch and duration",
        [
            {"op": "update_note", "id": "a1", "set": {"pitch": "C5", "dur": 240}},
        ],
    ),
    (
        "update can move a note to another measure",
        [
            {"op": "update_note", "id": "a2", "set": {"measure": 2, "start": 960}},
        ],
    ),
    (
        "update that overflows the measure fails",
        [
            {"op": "update_note", "id": "a2", "set": {"dur": 1920}},
        ],
    ),
    (
        "set and clear chords",
        [
            {"op": "set_chord", "measure": 1, "chord": "Gmaj7"},
            {"op": "set_chord", "measure": 2, "chord": None},
        ],
    ),
    ("set a section", [{"op": "set_section", "measure": 2, "section": "Chorus"}]),
    (
        "insert measures renumbers and keeps notes with their measure",
        [
            {"op": "insert_measures", "at": 2, "count": 2},
        ],
    ),
    ("insert at the end appends", [{"op": "insert_measures", "at": 3}]),
    ("insert past the end fails", [{"op": "insert_measures", "at": 4}]),
    (
        "insert then write into the new measure",
        [
            {"op": "insert_measures", "at": 3},
            {"op": "add_note", "measure": 3, "note": note("x1", "RH", "G4", 0, 1920)},
        ],
    ),
    ("delete a measure", [{"op": "delete_measures", "at": 1}]),
    ("deleting every measure fails", [{"op": "delete_measures", "at": 1, "count": 2}]),
    (
        "set tempo and key",
        [
            {
                "op": "set_meta",
                "set": {"tempo": 72, "key": "E", "mode": "minor", "title": "Renamed"},
            },
        ],
    ),
    (
        "shrinking the time signature under existing notes fails",
        [
            {"op": "set_meta", "set": {"time": [3, 4]}},
        ],
    ),
    ("an unknown key fails", [{"op": "set_meta", "set": {"key": "H"}}]),
    (
        "ops are atomic: a later failure reports its index",
        [
            {"op": "set_chord", "measure": 1, "chord": "Em"},
            {"op": "remove_note", "id": "missing"},
        ],
    ),
]


def run_case(base: Score, ops: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        result = apply_ops(base, OpList.validate_python(ops))
    except OpError as err:
        return {"error": {"index": err.index, "code": err.code}}
    return {"score": result.model_dump(mode="json")}


def build() -> dict[str, Any]:
    base = Score.model_validate(BASE)
    return {
        "base": base.model_dump(mode="json"),
        "cases": [{"name": name, "ops": ops, **run_case(base, ops)} for name, ops in CASES],
    }


if __name__ == "__main__":
    FIXTURE.write_text(json.dumps(build(), indent=2) + "\n")
    print(f"wrote {FIXTURE}")
