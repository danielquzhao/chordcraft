"""arq worker that runs agent edit jobs. Run from api/: .venv/bin/arq app.worker.WorkerSettings"""

from typing import Any

from arq.connections import RedisSettings

from app.config import get_settings
from app.db import SessionLocal
from app.edits.service import run_job


async def run_edit_job(ctx: dict[str, Any], job_id: str) -> str:
    # ctx["redis"] is arq's own connection; reuse it for progress events.
    return await run_job(ctx.get("sessions", SessionLocal), ctx["redis"], job_id)


class WorkerSettings:
    functions = [run_edit_job]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    # An edit is a few model calls; give slow ones room, but don't let a stuck one hang forever.
    job_timeout = 300
    max_tries = 1
