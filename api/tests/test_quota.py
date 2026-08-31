"""Daily limits on agent edits and Tab suggestions, per signed-in user."""

import pytest
from test_auth import ALICE, BLANK, BOB, as_user, secret_auth  # noqa: F401
from test_suggest import NINE_BARS, bar, use_model  # noqa: F401

from app import quota

SELECTION = {"start": 1, "end": 1}


@pytest.fixture
def limits(monkeypatch):
    def set_limits(edits=0, suggestions=0):
        monkeypatch.setattr(quota, "_limit", lambda kind: edits if kind == "edits" else suggestions)

    return set_limits


async def new_score(client, who, score=None):
    res = await client.post("/scores", json={"score": score}, headers=as_user(who))
    return res.json()["id"]


async def edit(client, sid, who):
    return await client.post(
        f"/scores/{sid}/edits",
        json={"instruction": "x", "selection": SELECTION, "base": 1},
        headers=as_user(who),
    )


async def chat(client, sid, who):
    return await client.post(
        f"/scores/{sid}/messages",
        json={"content": "x", "selection": SELECTION, "base": 1},
        headers=as_user(who),
    )


async def test_edits_and_chat_share_a_daily_limit(client, secret_auth, limits):  # noqa: F811
    limits(edits=2)
    sid = await new_score(client, ALICE)
    assert (await edit(client, sid, ALICE)).status_code == 201
    assert (await chat(client, sid, ALICE)).status_code == 201

    for res in (await edit(client, sid, ALICE), await chat(client, sid, ALICE)):
        assert res.status_code == 429
        assert res.json()["detail"]["code"] == "daily_limit"
        assert "2 agent edits" in res.json()["detail"]["message"]

    # Someone else's count is their own.
    assert (await edit(client, await new_score(client, BOB), BOB)).status_code == 201


async def test_a_failed_request_is_not_counted(client, secret_auth, limits):  # noqa: F811
    limits(edits=1)
    sid = await new_score(client, ALICE)
    stale = await client.post(
        f"/scores/{sid}/edits",
        json={"instruction": "x", "selection": SELECTION, "base": 99},
        headers=as_user(ALICE),
    )
    assert stale.status_code == 409
    assert (await edit(client, sid, ALICE)).status_code == 201


async def test_suggestions_stop_quietly_at_the_limit(client, secret_auth, limits, use_model):  # noqa: F811
    limits(suggestions=1)
    model = use_model(bar(("D3", 1, "whole")), bar(("D3", 1, "whole")))
    sid = await new_score(client, ALICE, NINE_BARS)

    async def suggest():
        res = await client.post(
            f"/scores/{sid}/suggest",
            json={"base": 1, "measure": 9, "staff": "LH"},
            headers=as_user(ALICE),
        )
        assert res.status_code == 200
        return res.json()["ops"]

    assert len(await suggest()) == 1
    assert await suggest() == []
    assert len(model.seen) == 1  # the second request never reached the model


async def test_no_limits_without_sign_in(client, limits):
    limits(edits=1)
    sid = (await client.post("/scores", json=BLANK)).json()["id"]
    for _ in range(3):
        res = await client.post(
            f"/scores/{sid}/edits", json={"instruction": "x", "selection": SELECTION, "base": 1}
        )
        assert res.status_code == 201
