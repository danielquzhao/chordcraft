import pytest

from app.score.pitch import (
    diatonic_index,
    from_diatonic,
    key_alter,
    key_fifths,
    parse_pitch,
    to_midi,
)


@pytest.mark.parametrize(
    ("name", "midi"),
    [("C4", 60), ("A0", 21), ("C8", 108), ("F#3", 54), ("Gb3", 54), ("B#3", 60), ("Cbb4", 58)],
)
def test_to_midi(name, midi):
    assert to_midi(name) == midi


@pytest.mark.parametrize("name", ["H4", "C9", "c4", "C#", "F###3", ""])
def test_parse_rejects_bad_names(name):
    with pytest.raises(ValueError):
        parse_pitch(name)


def test_key_fifths():
    assert key_fifths("D", "major") == 2
    assert key_fifths("Bb", "major") == -2
    assert key_fifths("B", "minor") == 2
    with pytest.raises(ValueError):
        key_fifths("Fb", "major")


def test_key_alter_follows_signature_order():
    # D major: F# and C#.
    assert [key_alter(s, 2) for s in "CDEFGAB"] == [1, 0, 0, 1, 0, 0, 0]
    # Eb major: Bb, Eb, Ab.
    assert [key_alter(s, -3) for s in "CDEFGAB"] == [0, 0, -1, 0, 0, -1, -1]


def test_diatonic_round_trip_in_key():
    assert diatonic_index("C4") == 28
    assert from_diatonic(diatonic_index("E3") + 1, 2) == "F#3"
    assert from_diatonic(diatonic_index("B3") + 1, 2) == "C#4"
    assert from_diatonic(diatonic_index("C4") - 1, -1) == "Bb3"
