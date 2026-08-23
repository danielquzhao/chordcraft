"""Converting between ticks and the beats and note names the model works in.

The model reads and writes rhythm as "start at beat 2.5, eighth note" rather than raw ticks:
it's how musicians talk, and it keeps arithmetic mistakes out of the model's hands.
"""

from app.score.model import Meta

# Note values relative to a quarter note.
DURATION_QUARTERS: dict[str, float] = {
    "whole": 4,
    "dotted-half": 3,
    "half": 2,
    "dotted-quarter": 1.5,
    "quarter": 1,
    "dotted-eighth": 0.75,
    "eighth": 0.5,
    "sixteenth": 0.25,
}
DURATION_NAMES = list(DURATION_QUARTERS)


def beat_ticks(meta: Meta) -> int:
    """Ticks per beat; the beat is the time signature's denominator (quarter in 4/4)."""
    return meta.ppq * 4 // meta.time[1]


def duration_ticks(name: str, meta: Meta) -> int:
    return round(DURATION_QUARTERS[name] * meta.ppq)


def duration_name(ticks: int, meta: Meta) -> str:
    for name, quarters in DURATION_QUARTERS.items():
        if round(quarters * meta.ppq) == ticks:
            return name
    return f"{ticks} ticks"


def beat_to_tick(beat: float, meta: Meta) -> int | None:
    """1-based beat -> tick offset, or None if it doesn't land on a sixteenth-note grid."""
    ticks = (beat - 1) * beat_ticks(meta)
    grid = meta.ppq // 4
    if ticks < 0 or abs(ticks - round(ticks)) > 1e-6 or round(ticks) % grid:
        return None
    return round(ticks)


def tick_to_beat(tick: int, meta: Meta) -> str:
    beat = 1 + tick / beat_ticks(meta)
    return f"{beat:g}"
