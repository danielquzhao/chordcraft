"""Per-user daily limits on model calls, so one account can't run up the bill.

Counts live in Redis, one key per user, kind and UTC day, and reset at midnight UTC. With
auth off (local development) there's no user to count against, so nothing is limited.
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import HTTPException, status
from redis.asyncio import Redis

from app.auth import User
from app.config import get_settings

Kind = Literal["edits", "suggestions"]


def _limit(kind: Kind) -> int:
    s = get_settings()
    return s.daily_edit_limit if kind == "edits" else s.daily_suggestion_limit


def _key(kind: Kind, user: User) -> str:
    return f"quota:{kind}:{user.id}:{datetime.now(UTC):%Y-%m-%d}"


async def remaining(redis: Redis, user: User, kind: Kind) -> int | None:
    """How many are left today, or None when unlimited."""
    limit = _limit(kind)
    if user.id is None or limit <= 0:
        return None
    used = int(await redis.get(_key(kind, user)) or 0)
    return max(limit - used, 0)


async def record(redis: Redis, user: User, kind: Kind) -> None:
    if user.id is None or _limit(kind) <= 0:
        return
    key = _key(kind, user)
    if await redis.incr(key) == 1:
        await redis.expire(key, 2 * 24 * 3600)


async def check_edits(redis: Redis, user: User) -> None:
    """Raise 429 when today's agent edits (⌘K and chat) are used up."""
    if await remaining(redis, user, "edits") == 0:
        limit = _limit("edits")
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "daily_limit",
                "message": f"You've used today's {limit} agent edits. They reset at midnight UTC.",
            },
        )
