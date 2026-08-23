from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.db import engine
from app.redis import redis
from app.scores.router import router as scores_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await redis.aclose()
    await engine.dispose()


app = FastAPI(title="ChordCraft API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(scores_router)


async def _postgres_ok() -> bool:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def _redis_ok() -> bool:
    try:
        return bool(await redis.ping())
    except Exception:
        return False


@app.get("/health")
async def health() -> dict[str, object]:
    postgres, redis_up = await _postgres_ok(), await _redis_ok()
    return {
        "status": "ok" if postgres and redis_up else "degraded",
        "postgres": postgres,
        "redis": redis_up,
    }
