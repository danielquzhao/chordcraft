"""Progress events for an edit job, over Redis.

The worker publishes each event to a channel and also appends it to a short-lived log, so a
browser that connects late (or reconnects) replays what it missed before following live.
Every event carries a `seq` number for de-duplicating the replay against the live feed.
"""

import json
from collections.abc import AsyncIterator
from typing import Any

from redis.asyncio import Redis

LOG_TTL_SECONDS = 3600
TERMINAL = "done"


def _keys(job_id: str) -> tuple[str, str, str]:
    return f"edit:{job_id}:events", f"edit:{job_id}:log", f"edit:{job_id}:seq"


async def publish(redis: Redis, job_id: str, event: dict[str, Any]) -> None:
    channel, log, seq_key = _keys(job_id)
    seq = await redis.incr(seq_key)
    payload = json.dumps({"seq": seq, **event})
    async with redis.pipeline(transaction=True) as pipe:
        pipe.rpush(log, payload)
        pipe.expire(log, LOG_TTL_SECONDS)
        pipe.expire(seq_key, LOG_TTL_SECONDS)
        pipe.publish(channel, payload)
        await pipe.execute()


async def follow(redis: Redis, job_id: str) -> AsyncIterator[dict[str, Any]]:
    """Every event so far, then live ones, ending after the terminal "done" event."""
    channel, log, _ = _keys(job_id)
    pubsub = redis.pubsub()
    # Subscribe before reading the log so nothing published in between is lost.
    await pubsub.subscribe(channel)
    try:
        last = 0
        for raw in await redis.lrange(log, 0, -1):
            event = json.loads(raw)
            last = event["seq"]
            yield event
            if event["type"] == TERMINAL:
                return
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            event = json.loads(message["data"])
            if event["seq"] <= last:
                continue
            last = event["seq"]
            yield event
            if event["type"] == TERMINAL:
                return
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
