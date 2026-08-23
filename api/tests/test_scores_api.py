import json
from pathlib import Path

from sqlalchemy import text

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SKETCH = json.loads((FIXTURES / "autumn-sketch.json").read_text())


def add(note_id: str, measure: int, pitch: str, start: int = 0, dur: int = 480) -> dict:
    return {
        "op": "add_note",
        "measure": measure,
        "note": {"id": note_id, "staff": "RH", "pitch": pitch, "start": start, "dur": dur},
    }


async def create(client, score=None) -> dict:
    res = await client.post("/scores", json={"score": score})
    assert res.status_code == 201
    return res.json()


async def test_create_blank_and_from_score(client):
    blank = await create(client)
    assert blank["head"] == 1
    assert blank["title"] == "Untitled score"
    assert len(blank["score"]["measures"]) == 4

    sketch = await create(client, SKETCH)
    assert sketch["title"] == "Autumn Sketch"
    assert sketch["score"] == SKETCH

    listed = (await client.get("/scores")).json()
    assert {s["id"] for s in listed} == {blank["id"], sketch["id"]}


async def test_save_appends_a_revision(client):
    s = await create(client)
    res = await client.post(
        f"/scores/{s['id']}/revisions", json={"base": 1, "ops": [add("x", 1, "C5")]}
    )
    assert res.json() == {"head": 2}

    detail = (await client.get(f"/scores/{s['id']}")).json()
    assert detail["head"] == 2
    assert detail["score"]["measures"][0]["notes"][0]["pitch"] == "C5"
    # The original version is still there, untouched.
    v1 = (await client.get(f"/scores/{s['id']}/revisions/1")).json()
    assert v1["score"]["measures"][0]["notes"] == []


async def test_stale_base_is_a_conflict(client):
    s = await create(client)
    url = f"/scores/{s['id']}/revisions"
    await client.post(url, json={"base": 1, "ops": [add("x", 1, "C5")]})
    res = await client.post(url, json={"base": 1, "ops": [add("y", 1, "D5", 480)]})
    assert res.status_code == 409
    assert res.json()["detail"] == {"code": "conflict", "head": 2}


async def test_ops_that_fail_are_rejected_without_saving(client):
    s = await create(client)
    url = f"/scores/{s['id']}/revisions"
    res = await client.post(url, json={"base": 1, "ops": [add("x", 1, "C5"), add("x", 1, "D5")]})
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "duplicate_id"
    assert res.json()["detail"]["index"] == 1
    assert (await client.get(f"/scores/{s['id']}")).json()["head"] == 1

    bad_shape = await client.post(url, json={"base": 1, "ops": [add("x", 1, "H9")]})
    assert bad_shape.status_code == 422


async def test_title_follows_the_score(client):
    s = await create(client)
    await client.post(
        f"/scores/{s['id']}/revisions",
        json={"base": 1, "ops": [{"op": "set_meta", "set": {"title": "Nocturne"}}]},
    )
    assert (await client.get(f"/scores/{s['id']}")).json()["title"] == "Nocturne"


async def test_history_groups_quick_edits(client, engine):
    s = await create(client)
    url = f"/scores/{s['id']}/revisions"
    await client.post(url, json={"base": 1, "ops": [add("a", 1, "C5")]})
    await client.post(url, json={"base": 2, "ops": [add("b", 2, "D5")]})
    await client.post(url, json={"base": 3, "ops": [{"op": "set_meta", "set": {"tempo": 70}}]})

    history = (await client.get(f"/scores/{s['id']}/history")).json()
    assert [(h["number"], h["first_number"], h["message"]) for h in history] == [
        (4, 2, "Edited notes in m. 1–2, changed tempo"),
        (1, 1, "Created"),
    ]

    # A pause longer than a minute starts a new entry.
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE revisions SET created_at = created_at - interval '5 minutes'"
                " WHERE number <= 3"
            )
        )
    history = (await client.get(f"/scores/{s['id']}/history")).json()
    assert [(h["number"], h["first_number"]) for h in history] == [(4, 4), (3, 2), (1, 1)]


async def test_restore_adds_a_new_head(client):
    s = await create(client)
    await client.post(f"/scores/{s['id']}/revisions", json={"base": 1, "ops": [add("x", 1, "C5")]})
    stale = await client.post(f"/scores/{s['id']}/restore", json={"base": 1, "number": 1})
    assert stale.status_code == 409

    res = await client.post(f"/scores/{s['id']}/restore", json={"base": 2, "number": 1})
    assert res.json()["head"] == 3
    assert res.json()["score"]["measures"][0]["notes"] == []
    history = (await client.get(f"/scores/{s['id']}/history")).json()
    assert history[0]["message"] == "Restored v1"
    assert history[0]["kind"] == "restore"


async def test_missing_and_deleted_scores_404(client):
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.get(f"/scores/{missing}")).status_code == 404
    assert (await client.get(f"/scores/{missing}/history")).status_code == 404

    s = await create(client)
    assert (await client.delete(f"/scores/{s['id']}")).status_code == 204
    assert (await client.get(f"/scores/{s['id']}")).status_code == 404
    assert (await client.get(f"/scores/{s['id']}/revisions/1")).status_code == 404
