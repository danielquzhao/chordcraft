"""Edit jobs end to end: API, worker job (scripted model), events, accept/reject."""

import asyncio
import inspect
import json
from pathlib import Path

from test_agent import WALKING, FakeModel, call, turn, walking_bass_calls

from app.edits import events
from app.edits.service import run_job

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SKETCH = json.loads((FIXTURES / "autumn-sketch.json").read_text())
LH_5_8 = {"start": 5, "end": 8, "staves": ["LH"]}
WALK = "Turn the left hand into a walking bass line"


def walking_model():
    return FakeModel(
        [
            turn(*walking_bass_calls()),
            turn(call("submit_edit", summary="Walking bass in m. 5–8.")),
        ]
    )


async def setup(client, instruction=WALK, selection=LH_5_8) -> tuple[str, str]:
    score = (await client.post("/scores", json={"score": SKETCH})).json()
    res = await client.post(
        f"/scores/{score['id']}/edits",
        json={"instruction": instruction, "selection": selection, "base": 1},
    )
    assert res.status_code == 201, res.text
    return score["id"], res.json()["id"]


def lh(score: dict, n: int) -> list[str]:
    return [x["pitch"] for x in score["measures"][n - 1]["notes"] if x["staff"] == "LH"]


async def test_create_queues_a_job(client, queue):
    _, job_id = await setup(client)
    job = (await client.get(f"/edits/{job_id}")).json()
    assert job["status"] == "queued"
    assert job["selection"] == LH_5_8
    assert queue.jobs == [("run_edit_job", (job_id,))]


async def test_create_rejects_stale_base_and_bad_selection(client):
    score = (await client.post("/scores", json={"score": SKETCH})).json()
    url = f"/scores/{score['id']}/edits"
    stale = await client.post(url, json={"instruction": "x", "selection": LH_5_8, "base": 7})
    assert stale.status_code == 409
    beyond = {"start": 7, "end": 12, "staves": ["LH"]}
    bad = await client.post(url, json={"instruction": "x", "selection": beyond, "base": 1})
    assert bad.status_code == 422


async def test_worker_runs_the_agent_and_streams_steps(client, sessions, redis):
    _, job_id = await setup(client)

    # Follow live from before the job starts; every event should arrive, in order.
    async def collect():
        return [e async for e in events.follow(redis, job_id)]

    follower = asyncio.create_task(collect())
    await asyncio.sleep(0.05)
    assert await run_job(sessions, redis, job_id, walking_model) == "ready"
    streamed = await asyncio.wait_for(follower, 5)

    assert streamed[0] == {"seq": 1, "type": "status", "status": "running"}
    assert [e["seq"] for e in streamed] == list(range(1, len(streamed) + 1))
    assert streamed[-1]["type"] == "done" and streamed[-1]["status"] == "ready"
    names = [e["name"] for e in streamed if e["type"] == "step"]
    assert names[0] == "read_score" and names[-1] == "validate"

    # A late subscriber replays the same events from the log.
    assert [e async for e in events.follow(redis, job_id)] == streamed

    job = (await client.get(f"/edits/{job_id}")).json()
    assert job["status"] == "ready"
    assert len(job["proposal"]["ops"]) == 20
    assert job["proposal"]["report"]["checks"][0]["status"] == "pass"


async def test_events_endpoint_for_a_finished_job(client, sessions, redis):
    _, job_id = await setup(client)
    await run_job(sessions, redis, job_id, walking_model)
    await redis.flushdb()  # the event log has expired
    res = await client.get(f"/edits/{job_id}/events")
    assert res.headers["content-type"].startswith("text/event-stream")
    assert res.text == 'data: {"seq": 0, "type": "done", "status": "ready", "error": null}\n\n'


async def test_accept_saves_an_agent_revision(client, sessions, redis):
    score_id, job_id = await setup(client)
    await run_job(sessions, redis, job_id, walking_model)

    res = await client.post(f"/edits/{job_id}/accept")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["head"] == 2
    assert [lh(body["score"], n) for n in range(5, 9)] == WALKING
    assert len(body["ops"]) == 20

    detail = (await client.get(f"/scores/{score_id}")).json()
    assert detail["head"] == 2 and detail["score"] == body["score"]
    top = (await client.get(f"/scores/{score_id}/history")).json()[0]
    assert (top["author"], top["message"]) == ("agent", WALK)
    job = (await client.get(f"/edits/{job_id}")).json()
    assert (job["status"], job["accepted_revision"]) == ("accepted", 2)

    again = await client.post(f"/edits/{job_id}/accept")
    assert again.status_code == 409


async def test_accept_after_unrelated_edits_rebases(client, sessions, redis):
    score_id, job_id = await setup(client)
    await run_job(sessions, redis, job_id, walking_model)
    # Meanwhile the musician changes the melody in bar 1, away from the agent's bass edit.
    await client.post(
        f"/scores/{score_id}/revisions",
        json={"base": 1, "ops": [{"op": "update_note", "id": "n_m1rh1", "set": {"pitch": "G4"}}]},
    )
    res = await client.post(f"/edits/{job_id}/accept")
    assert res.status_code == 200, res.text
    score = res.json()["score"]
    assert res.json()["head"] == 3
    assert score["measures"][0]["notes"][0]["pitch"] == "G4"
    assert [lh(score, n) for n in range(5, 9)] == WALKING


async def test_accept_conflicts_when_the_same_notes_changed(client, sessions, redis):
    score_id, job_id = await setup(client)
    await run_job(sessions, redis, job_id, walking_model)
    await client.post(
        f"/scores/{score_id}/revisions",
        json={"base": 1, "ops": [{"op": "update_note", "id": "n_m6lh1", "set": {"pitch": "D3"}}]},
    )
    res = await client.post(f"/edits/{job_id}/accept")
    assert res.status_code == 409
    assert res.json()["detail"] == {"code": "conflict", "head": 2}


async def test_reject(client, sessions, redis):
    score_id, job_id = await setup(client)
    await run_job(sessions, redis, job_id, walking_model)
    assert (await client.post(f"/edits/{job_id}/reject")).status_code == 204
    assert (await client.post(f"/edits/{job_id}/accept")).status_code == 409
    assert (await client.get(f"/scores/{score_id}")).json()["head"] == 1


async def test_rejecting_while_running_wins(client, sessions, redis):
    _, job_id = await setup(client)

    async def reject_midway(messages):
        await client.post(f"/edits/{job_id}/reject")
        return turn(call("submit_edit", summary="Done."))

    class Rejecting(FakeModel):
        async def turn(self, system, messages, tools):
            step = self.script.pop(0)
            return await step(messages) if inspect.iscoroutinefunction(step) else step

    model = Rejecting([turn(*walking_bass_calls()), reject_midway])
    assert await run_job(sessions, redis, job_id, lambda: model) == "rejected"
    job = (await client.get(f"/edits/{job_id}")).json()
    assert job["status"] == "rejected" and job["proposal"] is None


async def test_failed_run(client, sessions, redis):
    _, job_id = await setup(client)
    model = FakeModel([turn(stop="refusal")])
    assert await run_job(sessions, redis, job_id, lambda: model) == "failed"
    job = (await client.get(f"/edits/{job_id}")).json()
    assert job["error"] == "The model declined this request."
    assert (await client.post(f"/edits/{job_id}/accept")).status_code == 409
