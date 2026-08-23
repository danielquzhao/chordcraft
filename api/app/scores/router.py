import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import ScoreRow
from app.score.model import Score
from app.score.ops import OpError
from app.scores import service
from app.scores.schemas import (
    CreateScore,
    HistoryEntry,
    Restore,
    RevisionDetail,
    Saved,
    SaveEdit,
    ScoreDetail,
    ScoreSummary,
)

router = APIRouter(prefix="/scores", tags=["scores"])
Session = Annotated[AsyncSession, Depends(get_session)]


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})


def _conflict(err: service.Conflict) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail={"code": "conflict", "head": err.head})


def _op_error(err: OpError) -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={"code": err.code, "index": err.index, "message": err.message},
    )


def _summary(row: ScoreRow) -> ScoreSummary:
    return ScoreSummary(id=row.id, title=row.title, head=row.head, updated_at=row.updated_at)


@router.get("")
async def list_scores(session: Session) -> list[ScoreSummary]:
    rows = await session.scalars(select(ScoreRow).order_by(ScoreRow.updated_at.desc()))
    return [_summary(row) for row in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_score(body: CreateScore, session: Session) -> ScoreDetail:
    row, score = await service.create_score(session, body.score)
    return ScoreDetail(**_summary(row).model_dump(), score=score)


@router.get("/{score_id}")
async def get_score(score_id: uuid.UUID, session: Session) -> ScoreDetail:
    try:
        row = await service.get_score(session, score_id)
        score = await service.head_score(session, row)
    except service.NotFound:
        raise _not_found() from None
    return ScoreDetail(**_summary(row).model_dump(), score=score)


@router.delete("/{score_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_score(score_id: uuid.UUID, session: Session) -> Response:
    try:
        row = await service.get_score(session, score_id)
    except service.NotFound:
        raise _not_found() from None
    await session.delete(row)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{score_id}/revisions")
async def save_edit(score_id: uuid.UUID, body: SaveEdit, session: Session) -> Saved:
    try:
        head = await service.save_edit(session, score_id, body.base, body.ops)
    except service.NotFound:
        raise _not_found() from None
    except service.Conflict as err:
        raise _conflict(err) from None
    except OpError as err:
        raise _op_error(err) from None
    return Saved(head=head)


@router.post("/{score_id}/restore")
async def restore(score_id: uuid.UUID, body: Restore, session: Session) -> ScoreDetail:
    try:
        await service.restore(session, score_id, body.base, body.number)
        row = await service.get_score(session, score_id)
        score = await service.head_score(session, row)
    except service.NotFound:
        raise _not_found() from None
    except service.Conflict as err:
        raise _conflict(err) from None
    return ScoreDetail(**_summary(row).model_dump(), score=score)


@router.get("/{score_id}/history")
async def history(score_id: uuid.UUID, session: Session) -> list[HistoryEntry]:
    try:
        return await service.history(session, score_id)
    except service.NotFound:
        raise _not_found() from None


@router.get("/{score_id}/revisions/{number}")
async def get_revision(score_id: uuid.UUID, number: int, session: Session) -> RevisionDetail:
    try:
        rev = await service.get_revision(session, score_id, number)
    except service.NotFound:
        raise _not_found() from None
    return RevisionDetail(
        number=rev.number,
        message=rev.message,
        created_at=rev.created_at,
        score=Score.model_validate(rev.snapshot),
    )
