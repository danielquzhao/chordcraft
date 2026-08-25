"""The agent chat: messages, answers without edits, follow-ups with history."""

import json
from pathlib import Path

from test_agent import FakeModel, call, turn, walking_bass_calls

from app.edits.service import run_job

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SKETCH = json.loads((FIXTURES / "autumn-sketch.json").read_text())
ALL = {"start": 1, "end": 8, "staves": ["RH", "LH"]}
LH_5_8 = {"start": 5, "end": 8, "staves": ["LH"]}


async def new_score(client) -> str:
    return (await client.post("/scores", json={"score": SKETCH})).json()["id"]


async def send(client, score_id, content, selection=ALL, base=1) -> dict:
    res = await client.post(
        f"/scores/{score_id}/messages",
        json={"content": content, "selection": selection, "base": base},
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_a_question_gets_an_answer_and_no_edit(client, sessions, redis, queue):
    score_id = await new_score(client)
    sent = await send(client, score_id, "What key is this in?")
    assert sent["message"]["role"] == "user"
    assert sent["job"]["status"] == "queued"
    assert queue.jobs == [("run_edit_job", (sent["job"]["id"],))]

    # A plain-text reply is the answer; chat doesn't nudge it toward editing.
    model = FakeModel([turn(text="D major: two sharps, and it opens on a D chord.")])
    assert await run_job(sessions, redis, sent["job"]["id"], lambda: model) == "ready"
    assert len(model.seen) == 1

    messages = (await client.get(f"/scores/{score_id}/messages")).json()
    assert [(m["role"], m["content"]) for m in messages] == [
        ("user", "What key is this in?"),
        ("assistant", "D major: two sharps, and it opens on a D chord."),
    ]
    assert messages[1]["job_status"] == "ready"
    # Nothing to accept.
    assert (await client.post(f"/edits/{sent['job']['id']}/accept")).status_code == 409


async def test_follow_ups_see_the_conversation(client, sessions, redis):
    score_id = await new_score(client)
    first = await send(client, score_id, "Turn the left hand into a walking bass", LH_5_8)
    await run_job(
        sessions,
        redis,
        first["job"]["id"],
        lambda: FakeModel(
            [
                turn(*walking_bass_calls()),
                turn(call("submit_edit", summary="Walking bass in m. 5–8.")),
            ]
        ),
    )
    await client.post(f"/edits/{first['job']['id']}/accept")

    second = await send(client, score_id, "Make it a bit busier", LH_5_8, base=2)
    model = FakeModel([turn(text="Sure. Shall I add eighth-note pickups into each bar?")])
    await run_job(sessions, redis, second["job"]["id"], lambda: model)

    prompt = model.seen[0][0]["content"]
    assert "Earlier in this conversation:" in prompt
    assert "Musician: Turn the left hand into a walking bass" in prompt
    assert "You: Walking bass in m. 5–8." in prompt
    assert prompt.endswith("Request: Make it a bit busier")

    messages = (await client.get(f"/scores/{score_id}/messages")).json()
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
    assert messages[1]["job_status"] == "accepted"


async def test_chat_requires_a_current_base(client):
    score_id = await new_score(client)
    res = await client.post(
        f"/scores/{score_id}/messages",
        json={"content": "hi", "selection": ALL, "base": 5},
    )
    assert res.status_code == 409
    assert (await client.get(f"/scores/{score_id}/messages")).json() == []
