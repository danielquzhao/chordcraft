"""The arq job queue, as seen from the API (the worker lives in app/worker.py)."""

from typing import Protocol

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.config import get_settings


class Queue(Protocol):
    async def enqueue_job(self, function: str, *args: object, _job_id: str | None = None): ...


_pool: ArqRedis | None = None


async def get_queue() -> Queue:
    """FastAPI dependency: a shared arq pool, created on first use."""
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _pool


async def close_queue() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
