"""Pitch spelling helpers.

Pitches are spelled names like "F#3" or "Bb4" so enharmonics stay correct. These helpers convert
between spelled names, MIDI numbers, and diatonic positions, and know which accidentals a key
signature implies. Mirrored in web/src/score/pitch.ts.
"""

import re
from dataclasses import dataclass

STEPS = "CDEFGAB"
STEP_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ALTERS = {"": 0, "#": 1, "##": 2, "b": -1, "bb": -2}
ALTER_SYMBOLS = {v: k for k, v in ALTERS.items()}

PIANO_LOW = 21  # A0
PIANO_HIGH = 108  # C8

_PITCH_RE = re.compile(r"^([A-G])(##|#|bb|b)?([0-8])$")

# Position in the circle of fifths: positive = sharps, negative = flats.
MAJOR_KEYS = {
    "Cb": -7, "Gb": -6, "Db": -5, "Ab": -4, "Eb": -3, "Bb": -2, "F": -1, "C": 0,
    "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
}  # fmt: skip
MINOR_KEYS = {
    "Ab": -7, "Eb": -6, "Bb": -5, "F": -4, "C": -3, "G": -2, "D": -1, "A": 0,
    "E": 1, "B": 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7,
}  # fmt: skip
SHARP_ORDER = "FCGDAEB"
FLAT_ORDER = "BEADGCF"


@dataclass(frozen=True)
class Pitch:
    step: str
    alter: int
    octave: int

    def __str__(self) -> str:
        return f"{self.step}{ALTER_SYMBOLS[self.alter]}{self.octave}"


def parse_pitch(name: str) -> Pitch:
    match = _PITCH_RE.match(name)
    if not match:
        raise ValueError(f"invalid pitch {name!r}")
    step, alter, octave = match.groups()
    return Pitch(step, ALTERS[alter or ""], int(octave))


def is_valid_pitch(name: str) -> bool:
    return _PITCH_RE.match(name) is not None


def to_midi(name: str) -> int:
    p = parse_pitch(name)
    return 12 * (p.octave + 1) + STEP_SEMITONES[p.step] + p.alter


def diatonic_index(name: str) -> int:
    p = parse_pitch(name)
    return p.octave * 7 + STEPS.index(p.step)


def key_fifths(key: str, mode: str) -> int:
    table = MAJOR_KEYS if mode == "major" else MINOR_KEYS
    if key not in table:
        raise ValueError(f"unknown {mode} key {key!r}")
    return table[key]


def key_alter(step: str, fifths: int) -> int:
    """The accidental the key signature applies to a step (1 sharp, -1 flat, 0 natural)."""
    if fifths > 0 and step in SHARP_ORDER[:fifths]:
        return 1
    if fifths < 0 and step in FLAT_ORDER[:-fifths]:
        return -1
    return 0


def from_diatonic(index: int, fifths: int) -> str:
    """Spell the note at a diatonic position using the key signature's accidental."""
    octave, step_i = divmod(index, 7)
    step = STEPS[step_i]
    return str(Pitch(step, key_alter(step, fifths), octave))
