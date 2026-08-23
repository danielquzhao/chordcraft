from app.agent.context import Selection
from app.agent.validate import validate
from app.score.model import Score

ALL = Selection(start=1, end=1)


def score(*notes: tuple[str, str, int, int], key: str = "D") -> Score:
    """One 4/4 measure from (staff, pitch, start, dur) tuples."""
    return Score.model_validate(
        {
            "meta": {"key": key},
            "measures": [
                {
                    "n": 1,
                    "notes": [
                        {"id": f"x{i}", "staff": st, "pitch": p, "start": s, "dur": d}
                        for i, (st, p, s, d) in enumerate(notes)
                    ],
                }
            ],
        }
    )


def check(report, check_id):
    return next(c for c in report.checks if c.id == check_id)


def test_clean_edit_passes():
    base = score()
    draft = score(("RH", "F#4", 0, 960), ("RH", "A4", 960, 960), ("LH", "D3", 0, 1920))
    report = validate(base, draft, ALL)
    assert report.passed
    assert all(c.status == "pass" for c in report.checks)


def test_overlapping_notes_fail_rhythm():
    draft = score(("LH", "D3", 0, 960), ("LH", "E3", 480, 480))
    report = validate(score(), draft, ALL)
    assert not report.passed
    assert check(report, "rhythm").details == [
        "m1 LH beat 2: starts before the note at beat 1 has finished"
    ]


def test_chord_with_mixed_lengths_fails_rhythm():
    draft = score(("RH", "D4", 0, 960), ("RH", "F#4", 0, 480))
    assert (
        "different lengths (quarter, half)"
        in check(validate(score(), draft, ALL), "rhythm").details[0]
    )


def test_wide_chord_fails_span():
    draft = score(("LH", "D2", 0, 1920), ("LH", "A3", 0, 1920))
    report = validate(score(), draft, ALL)
    assert check(report, "span").status == "fail"
    assert "D2–A3 is wider than a tenth" in report.failures()[0]


def test_hand_range_is_a_warning():
    draft = score(("LH", "E5", 0, 480), ("RH", "G2", 480, 480))
    report = validate(score(), draft, ALL)
    assert report.passed
    assert len(check(report, "range").details) == 2


def test_parallel_fifths_are_flagged():
    # D3/A3 -> E3/B3: bass and melody both rise, a fifth apart each time.
    rising = score(
        ("LH", "D3", 0, 480), ("RH", "A3", 0, 480), ("LH", "E3", 480, 480), ("RH", "B3", 480, 480)
    )
    assert check(validate(score(), rising, ALL), "voice_leading").details == [
        "m1 beat 1 → m1 beat 2: parallel fifths between bass and melody"
    ]
    # Fifths reached by contrary motion (bass up, melody down) are fine.
    contrary = score(
        ("LH", "D3", 0, 480), ("RH", "A4", 0, 480), ("LH", "E3", 480, 480), ("RH", "B3", 480, 480)
    )
    assert check(validate(score(), contrary, ALL), "voice_leading").status == "pass"


def test_spelling_against_the_key():
    draft = score(("RH", "Gb4", 0, 480), ("RH", "G#4", 480, 480), ("RH", "C##5", 960, 480))
    details = check(validate(score(), draft, ALL), "spelling").details
    # Gb4 is F#4 in D major; G#4 is a legitimate chromatic note; C##5 is a double accidental.
    assert details == [
        "m1 RH beat 1: write Gb4 as F#4 in D major",
        "m1 RH beat 3: C##5 uses a double accidental",
    ]


def test_only_new_problems_are_reported():
    existing = score(("LH", "D2", 0, 1920), ("LH", "A3", 0, 1920))  # already too wide
    draft = score(("LH", "D2", 0, 1920), ("LH", "A3", 0, 1920), ("RH", "F#4", 0, 1920))
    assert validate(existing, draft, ALL).passed


def test_checks_only_look_at_the_selected_hand():
    draft = score(("LH", "D2", 0, 1920), ("LH", "A3", 0, 1920))
    assert validate(score(), draft, Selection(start=1, end=1, staves=["RH"])).passed
