import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import score_for
from app.agent.context import Selection
from app.auth import CurrentUser
from app.db import get_session
from app.edits import service as edits
from app.edits.router import job_view
from app.edits.schemas import EditJob, JobStatus
from app.models import EditJobRow, MessageRow
from app.queue import Queue, get_queue
from app.scores import service as scores

router = APIRouter(tags=["chat"])
Session = Annotated[AsyncSession, Depends(get_session)]
HISTORY_LIMIT = 200


class Message(BaseModel):
    id: uuid.UUID
    role: Literal["user", "assistant"]
    content: str
    job_id: uuid.UUID | None
    # The edit's status, so the panel can show "accepted" / "rejected" / "awaiting review".
    job_status: JobStatus | None
    created_at: datetime


class SendMessage(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    selection: Selection
    base: int


class Sent(BaseModel):
    message: Message
    job: EditJob


@router.get("/scores/{score_id}/messages")
async def list_messages(score_id: uuid.UUID, session: Session, user: CurrentUser) -> list[Message]:
    try:
        await score_for(session, score_id, user)
    except scores.NotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"}) from None
    rows = await session.execute(
        select(MessageRow, EditJobRow.status)
        .outerjoin(EditJobRow, EditJobRow.id == MessageRow.job_id)
        .where(MessageRow.score_id == score_id)
        .order_by(MessageRow.created_at.desc(), MessageRow.role.desc())
        .limit(HISTORY_LIMIT)
    )
    out = [
        Message(
            id=m.id,
            role=m.role,  # type: ignore[arg-type]
            content=m.content,
            job_id=m.job_id,
            job_status=job_status,
            created_at=m.created_at,
        )
        for m, job_status in rows.all()
    ]
    return list(reversed(out))


@router.post("/scores/{score_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_message(
    score_id: uuid.UUID,
    body: SendMessage,
    session: Session,
    queue: Annotated[Queue, Depends(get_queue)],
    user: CurrentUser,
) -> Sent:
    """Post a chat message; the agent answers it (or proposes an edit) as a background job."""
    try:
        await score_for(session, score_id, user)
        job = await edits.create_job(
            session, score_id, body.base, body.content, body.selection, source="chat"
        )
    except scores.NotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"}) from None
    except scores.Conflict as err:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail={"code": "conflict", "head": err.head}
        ) from None
    except ValueError as err:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "bad_selection", "message": str(err)},
        ) from None
    message = MessageRow(score_id=score_id, role="user", content=body.content, job_id=job.id)
    session.add(message)
    await session.commit()
    await session.refresh(message)
    await queue.enqueue_job("run_edit_job", str(job.id), _job_id=str(job.id))
    return Sent(
        message=Message(
            id=message.id,
            role="user",
            content=message.content,
            job_id=job.id,
            job_status="queued",
            created_at=message.created_at,
        ),
        job=job_view(job),
    )
