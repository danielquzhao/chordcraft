"""MusicXML and MIDI import, using files music21 writes."""

import tempfile
from pathlib import Path

from music21 import chord, harmony, key, metadata, meter, note, stream, tempo


def piano_score() -> stream.Score:
    """Two bars in D major: melody over a bass line, with chord symbols and a title."""
    s = stream.Score()
    s.insert(0, metadata.Metadata(title="Imported Tune"))
    rh, lh = stream.Part(), stream.Part()
    m1 = stream.Measure(number=1)
    m1.append([key.Key("D"), meter.TimeSignature("4/4"), tempo.MetronomeMark(number=80)])
    m1.insert(0, harmony.ChordSymbol("D"))
    for p in ["F#4", "A4", "D5", "A4"]:
        m1.append(note.Note(p, quarterLength=1))
    m2 = stream.Measure(number=2)
    m2.insert(0, harmony.ChordSymbol("Bm"))
    m2.append(chord.Chord(["B4", "D5"], quarterLength=2))
    m2.append(note.Note("C#5", quarterLength=2))
    rh.append([m1, m2])
    b1 = stream.Measure(number=1)
    b1.append(note.Note("D3", quarterLength=4))
    b2 = stream.Measure(number=2)
    b2.append(note.Note("B2", quarterLength=2))
    b2.append(note.Note("F#3", quarterLength=2))
    lh.append([b1, b2])
    s.append([rh, lh])
    return s


def write(score: stream.Score, fmt: str, suffix: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"file{suffix}"
        score.write(fmt, path)
        return path.read_bytes()


def hand(detail: dict, n: int, staff: str) -> list[tuple[str, int, int]]:
    notes = detail["score"]["measures"][n - 1]["notes"]
    return [(x["pitch"], x["start"], x["dur"]) for x in notes if x["staff"] == staff]


async def test_musicxml_import(client):
    data = write(piano_score(), "musicxml", ".musicxml")
    res = await client.post("/scores/import", files={"file": ("tune.musicxml", data)})
    assert res.status_code == 201, res.text
    detail = res.json()
    meta = detail["score"]["meta"]
    assert (meta["title"], meta["key"], meta["mode"], meta["time"], meta["tempo"]) == (
        "Imported Tune",
        "D",
        "major",
        [4, 4],
        80,
    )
    assert [m["chord"] for m in detail["score"]["measures"]] == ["D", "Bm"]
    assert hand(detail, 1, "RH") == [
        ("F#4", 0, 480),
        ("A4", 480, 480),
        ("D5", 960, 480),
        ("A4", 1440, 480),
    ]
    assert hand(detail, 2, "RH") == [("B4", 0, 960), ("D5", 0, 960), ("C#5", 960, 960)]
    assert hand(detail, 1, "LH") == [("D3", 0, 1920)]
    assert hand(detail, 2, "LH") == [("B2", 0, 960), ("F#3", 960, 960)]
    # It's a normal score from here: listed, versioned, editable.
    assert detail["head"] == 1
    assert detail["id"] in [s["id"] for s in (await client.get("/scores")).json()]


async def test_midi_import_splits_hands_at_middle_c(client):
    flat = stream.Score()
    part = stream.Part()
    for m in piano_score().parts[0].getElementsByClass(stream.Measure):
        # music21 writes chord symbols into MIDI as sounding chords; real MIDI has none.
        m.removeByClass(harmony.ChordSymbol)
        part.append(m)
    flat.append(part)
    # One track holding both hands: a D3 under the melody in bar 1.
    part.getElementsByClass(stream.Measure)[0].insert(0, note.Note("D3", quarterLength=4))
    data = write(flat, "midi", ".mid")
    res = await client.post("/scores/import", files={"file": ("song.mid", data)})
    assert res.status_code == 201, res.text
    detail = res.json()
    assert detail["title"] == "song"
    assert [p for p, _, _ in hand(detail, 1, "RH")] == ["F#4", "A4", "D5", "A4"]
    assert hand(detail, 1, "LH") == [("D3", 0, 1920)]


async def test_rejects_other_files(client):
    res = await client.post("/scores/import", files={"file": ("notes.txt", b"hello")})
    assert res.status_code == 422
    assert "MusicXML" in res.json()["detail"]["message"]

    junk = await client.post("/scores/import", files={"file": ("broken.musicxml", b"<not xml")})
    assert junk.status_code == 422
