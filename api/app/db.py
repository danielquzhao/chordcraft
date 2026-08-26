from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


def _connect_args(url: str) -> dict[str, Any]:
    # Transaction-mode poolers (PgBouncer, Supabase's pooler on port 6543) can't keep
    # prepared statements across transactions; turn asyncpg's statement cache off there.
    if ":6543/" in url or "pgbouncer=true" in url:
        return {
            "statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
        }
    return {}


_url = get_settings().database_url
engine = create_async_engine(_url, pool_pre_ping=True, connect_args=_connect_args(_url))
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
