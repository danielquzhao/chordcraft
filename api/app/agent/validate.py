"""Deterministic checks on an edited score. No model involved.

Each check compares the draft with the original and reports only problems the edit
introduced, so the agent isn't blamed for issues that were already in the score.
"`fail`" sends the draft back to the model for repair; "`warn`" is shown to the user.
"""

from collections import defaultdict
from collections.abc import Callable, Iterable
from typing import Literal

from pydantic import BaseModel

from app.agent.context import Selection, key_name
from app.agent.timing import duration_name, tick_to_beat
from app.score.model import Note, Score
from app.score.pitch import (
    STEP_SEMITONES,
    STEPS,
    Pitch,
    key_alter,
    key_fifths,
    parse_pitch,
    to_midi,
)

# A major tenth: about the widest chord one hand can play.
MAX_SPAN = 16
RH_LOWEST = 48  # C3
LH_HIGHEST = 72  # C5

Status = Literal["pass", "warn", "fail"]


class Check(BaseModel):
    id: str
    label: str
    status: Status
    details: list[str] = []


class Report(BaseModel):
    checks: list[Check]

    @property
    def passed(self) -> bool:
        return all(c.status != "fail" for c in self.checks)

    def failures(self) -> list[str]:
        return [d for c in self.checks if c.status == "fail" for d in c.details]

    def warnings(self) -> list[str]:
        return [d for c in self.checks if c.status == "warn" for d in c.details]

    def as_text(self) -> str:
        lines = []
        for c in self.checks:
            mark = {"pass": "ok", "warn": "warning", "fail": "FAILED"}[c.status]
            lines.append(f"- {c.label}: {mark}")
            lines.extend(f"    {d}" for d in c.details)
        return "\n".join(lines)


def _where(score: Score, measure: int, staff: str, tick: int) -> str:
    return f"m{measure} {staff} beat {tick_to_beat(tick, score.meta)}"


def _selected_notes(score: Score, sel: Selection) -> Iterable[tuple[int, Note]]:
    for n in range(sel.start, min(sel.end, len(score.measures)) + 1):
        for note in score.measures[n - 1].notes:
            if note.staff in sel.staves:
                yield n, note


def _chords(score: Score, sel: Selection) -> dict[tuple[int, str, int, int], list[Note]]:
    """Notes grouped by (measure, staff, voice, start)."""
    groups: dict[tuple[int, str, int, int], list[Note]] = defaultdict(list)
    for n, note in _selected_notes(score, sel):
        groups[(n, note.staff, note.voice, note.start)].append(note)
    return groups


def rhythm_issues(score: Score, sel: Selection) -> list[str]:
    issues = []
    lines: dict[tuple[int, str, int], list[tuple[int, list[Note]]]] = defaultdict(list)
    for (n, staff, voice, start), notes in sorted(_chords(score, sel).items()):
        durs = sorted({x.dur for x in notes})
        if len(durs) > 1:
            names = ", ".join(duration_name(d, score.meta) for d in durs)
            issues.append(
                f"{_where(score, n, staff, start)}: notes struck together have different "
                f"lengths ({names}); make them one length or use separate voices"
            )
        lines[(n, staff, voice)].append((start, notes))
    for (n, staff, _voice), chords in lines.items():
        for (start, notes), (next_start, _) in zip(chords, chords[1:], strict=False):
            end = start + max(x.dur for x in notes)
            if next_start < end:
                issues.append(
                    f"{_where(score, n, staff, next_start)}: starts before the note at beat "
                    f"{tick_to_beat(start, score.meta)} has finished"
                )
    return issues


def span_issues(score: Score, sel: Selection) -> list[str]:
    issues = []
    for (n, staff, _voice, start), notes in sorted(_chords(score, sel).items()):
        low = min(notes, key=lambda x: to_midi(x.pitch))
        high = max(notes, key=lambda x: to_midi(x.pitch))
        if to_midi(high.pitch) - to_midi(low.pitch) > MAX_SPAN:
            issues.append(
                f"{_where(score, n, staff, start)}: {low.pitch}–{high.pitch} is wider than a "
                f"tenth, too far for one hand"
            )
    return issues


def range_issues(score: Score, sel: Selection) -> list[str]:
    issues = []
    for n, note in _selected_notes(score, sel):
        midi = to_midi(note.pitch)
        if note.staff == "RH" and midi < RH_LOWEST:
            issues.append(
                f"{_where(score, n, 'RH', note.start)}: {note.pitch} is low for the right hand"
            )
        if note.staff == "LH" and midi > LH_HIGHEST:
            issues.append(
                f"{_where(score, n, 'LH', note.start)}: {note.pitch} is high for the left hand"
            )
    return issues


def _outer_voices(score: Score, sel: Selection) -> list[tuple[str, int | None, int | None]]:
    """(position, bass midi, melody midi) at every onset in the selected measures."""
    out = []
    for n in range(sel.start, min(sel.end, len(score.measures)) + 1):
        notes = score.measures[n - 1].notes
        for t in sorted({x.start for x in notes}):
            sounding = [x for x in notes if x.start <= t < x.start + x.dur]
            bass = [to_midi(x.pitch) for x in sounding if x.staff == "LH"]
            top = [to_midi(x.pitch) for x in sounding if x.staff == "RH"]
            out.append(
                (
                    f"m{n} beat {tick_to_beat(t, score.meta)}",
                    min(bass) if bass else None,
                    max(top) if top else None,
                )
            )
    return out


def parallel_issues(score: Score, sel: Selection) -> list[str]:
    issues = []
    timeline = _outer_voices(score, sel)
    for (where_a, b1, t1), (where_b, b2, t2) in zip(timeline, timeline[1:], strict=False):
        if None in (b1, t1, b2, t2) or b1 == b2 or t1 == t2:
            continue
        assert b1 is not None and t1 is not None and b2 is not None and t2 is not None
        same_direction = (b2 - b1) * (t2 - t1) > 0
        i1, i2 = (t1 - b1) % 12, (t2 - b2) % 12
        if same_direction and i1 == i2 and i1 in (0, 7):
            kind = "octaves" if i1 == 0 else "fifths"
            issues.append(f"{where_a} → {where_b}: parallel {kind} between bass and melody")
    return issues


def _respell(p: Pitch, fifths: int) -> str | None:
    """An enharmonic spelling that matches the key signature, if there is one."""
    midi = to_midi(str(p))
    i = STEPS.index(p.step)
    for di in (-1, 1):
        j = i + di
        octave = p.octave + (j // 7)
        step = STEPS[j % 7]
        alter = key_alter(step, fifths)
        candidate = Pitch(step, alter, octave)
        if 12 * (octave + 1) + STEP_SEMITONES[step] + alter == midi:
            return str(candidate)
    return None


def spelling_issues(score: Score, sel: Selection) -> list[str]:
    issues = []
    fifths = key_fifths(score.meta.key, score.meta.mode)
    for n, note in _selected_notes(score, sel):
        p = parse_pitch(note.pitch)
        if abs(p.alter) == 2:
            issues.append(
                f"{_where(score, n, note.staff, note.start)}: {note.pitch} uses a double accidental"
            )
            continue
        if p.alter != key_alter(p.step, fifths):
            better = _respell(p, fifths)
            if better:
                issues.append(
                    f"{_where(score, n, note.staff, note.start)}: write {note.pitch} as "
                    f"{better} in {key_name(score)}"
                )
    return issues


CHECKS: list[tuple[str, str, Status, Callable[[Score, Selection], list[str]]]] = [
    ("rhythm", "Rhythm fits the bar", "fail", rhythm_issues),
    ("span", "Playable hand spans", "fail", span_issues),
    ("range", "Comfortable range for each hand", "warn", range_issues),
    ("voice_leading", "No parallel fifths or octaves", "warn", parallel_issues),
    ("spelling", "Accidentals spelled for the key", "warn", spelling_issues),
]


def validate(base: Score, draft: Score, selection: Selection) -> Report:
    checks = []
    for check_id, label, severity, find in CHECKS:
        before = set(find(base, selection))
        new = [issue for issue in find(draft, selection) if issue not in before]
        checks.append(
            Check(id=check_id, label=label, status=severity if new else "pass", details=new)
        )
    return Report(checks=checks)
