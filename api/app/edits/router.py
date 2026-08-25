import json
import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.edits import events, service
from app.edits.schemas import Accepted, CreateEdit, EditJob
from app.models import EditJobRow
from app.queue import Queue, get_queue
from app.redis import get_redis
from app.scores import service as scores

router = APIRouter(tags=["edits"])
Session = Annotated[AsyncSession, Depends(get_session)]


def job_view(row: EditJobRow) -> EditJob:
    return EditJob.model_validate(row, from_attributes=True)


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})


@router.post("/scores/{score_id}/edits", status_code=status.HTTP_201_CREATED)
async def create_edit(
    score_id: uuid.UUID,
    body: CreateEdit,
    session: Session,
    queue: Annotated[Queue, Depends(get_queue)],
) -> EditJob:
    try:
        row = await service.create_job(
            session, score_id, body.base, body.instruction, body.selection
        )
    except scores.NotFound:
        raise _not_found() from None
    except scores.Conflict as err:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail={"code": "conflict", "head": err.head}
        ) from None
    except ValueError as err:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "bad_selection", "message": str(err)},
        ) from None
    await queue.enqueue_job("run_edit_job", str(row.id), _job_id=str(row.id))
    return job_view(row)


@router.get("/edits/{job_id}")
async def get_edit(job_id: uuid.UUID, session: Session) -> EditJob:
    try:
        return job_view(await service.get_job(session, job_id))
    except service.NotFound:
        raise _not_found() from None


@router.get("/edits/{job_id}/events")
async def edit_events(
    job_id: uuid.UUID, session: Session, redis: Annotated[Redis, Depends(get_redis)]
) -> StreamingResponse:
    """Server-sent events: the agent's steps as they happen, ending with a "done" event."""
    try:
        job = await service.get_job(session, job_id)
    except service.NotFound:
        raise _not_found() from None

    async def stream() -> AsyncIterator[str]:
        if job.status not in service.OPEN:
            # Finished already (and its event log may have expired): just say so.
            done = {"seq": 0, "type": "done", "status": job.status, "error": job.error}
            yield f"data: {json.dumps(done)}\n\n"
            return
        async for event in events.follow(redis, str(job_id)):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/edits/{job_id}/accept")
async def accept_edit(job_id: uuid.UUID, session: Session) -> Accepted:
    try:
        head, score, ops = await service.accept(session, job_id)
    except service.NotFound:
        raise _not_found() from None
    except service.InvalidState as err:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail={"code": "not_ready", "status": err.status}
        ) from None
    except scores.Conflict as err:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail={"code": "conflict", "head": err.head}
        ) from None
    return Accepted(head=head, score=score, ops=ops)


@router.post("/edits/{job_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_edit(job_id: uuid.UUID, session: Session) -> Response:
    try:
        await service.reject(session, job_id)
    except service.NotFound:
        raise _not_found() from None
    except service.InvalidState as err:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail={"code": "not_open", "status": err.status}
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
