"""API tests run against a real Postgres database (`chordcraft_test` by default).

Set TEST_DATABASE_URL to point elsewhere; CI uses a Postgres service container.
"""

import os
from collections.abc import AsyncIterator
from urllib.parse import urlparse

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import models  # noqa: F401  (registers tables)
from app.db import Base, get_session
from app.main import app
from app.queue import get_queue
from app.redis import get_redis

TEST_REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://chordcraft:chordcraft@localhost:5433/chordcraft_test",
)


async def _ensure_database(url: str) -> None:
    name = urlparse(url).path.lstrip("/")
    admin = create_async_engine(url.rsplit("/", 1)[0] + "/postgres", isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": name}
        )
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{name}"'))
    await admin.dispose()


@pytest.fixture(scope="session")
async def engine():
    await _ensure_database(TEST_DATABASE_URL)
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


class RecordingQueue:
    def __init__(self):
        self.jobs: list[tuple[str, tuple]] = []

    async def enqueue_job(self, function, *args, _job_id=None):
        self.jobs.append((function, args))


@pytest.fixture
def sessions(engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def redis() -> AsyncIterator[Redis]:
    client = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
    await client.flushdb()
    yield client
    await client.aclose()


@pytest.fixture
def queue() -> RecordingQueue:
    return RecordingQueue()


@pytest.fixture
async def client(engine, redis, queue) -> AsyncIterator[AsyncClient]:
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE scores, revisions, edit_jobs, messages CASCADE"))
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def session_override() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_redis] = lambda: redis
    app.dependency_overrides[get_queue] = lambda: queue
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
