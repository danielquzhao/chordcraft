import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import score_for
from app.agent.model import Model, make_model
from app.agent.suggest import suggest_bar
from app.auth import CurrentUser
from app.config import get_settings
from app.db import get_session
from app.models import ScoreRow
from app.score.model import Score
from app.score.ops import OpError
from app.scores import service
from app.scores.importer import MAX_BYTES, ImportFailed, import_score
from app.scores.schemas import (
    CreateScore,
    HistoryEntry,
    Restore,
    RevisionDetail,
    Saved,
    SaveEdit,
    ScoreDetail,
    ScoreSummary,
    SuggestRequest,
    SuggestResponse,
)

router = APIRouter(prefix="/scores", tags=["scores"])
log = logging.getLogger(__name__)
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
async def list_scores(session: Session, user: CurrentUser) -> list[ScoreSummary]:
    query = select(ScoreRow).order_by(ScoreRow.updated_at.desc())
    if user.id is not None:
        query = query.where(ScoreRow.owner_id == user.id)
    rows = await session.scalars(query)
    return [_summary(row) for row in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_score(body: CreateScore, session: Session, user: CurrentUser) -> ScoreDetail:
    row, score = await service.create_score(session, body.score, owner_id=user.id)
    return ScoreDetail(**_summary(row).model_dump(), score=score)


@router.post("/starter")
async def starter_score(body: CreateScore, session: Session, user: CurrentUser) -> ScoreDetail:
    """First run: create the example score if this user has none, else return their latest.

    Idempotent, so two tabs opening at once end up with one example score, not two.
    """
    if body.score is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "no_score"})
    row, score = await service.ensure_starter(session, body.score, owner_id=user.id)
    return ScoreDetail(**_summary(row).model_dump(), score=score)


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_file(file: UploadFile, session: Session, user: CurrentUser) -> ScoreDetail:
    """Create a score from an uploaded MusicXML or MIDI file."""
    data = await file.read(MAX_BYTES + 1)
    try:
        # music21 parsing is CPU-bound; keep it off the event loop.
        score = await run_in_threadpool(import_score, data, file.filename or "upload")
    except ImportFailed as err:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "import_failed", "message": str(err)},
        ) from None
    row, score = await service.create_score(session, score, owner_id=user.id)
    return ScoreDetail(**_summary(row).model_dump(), score=score)


@router.get("/{score_id}")
async def get_score(score_id: uuid.UUID, session: Session, user: CurrentUser) -> ScoreDetail:
    try:
        row = await score_for(session, score_id, user)
        score = await service.head_score(session, row)
    except service.NotFound:
        raise _not_found() from None
    return ScoreDetail(**_summary(row).model_dump(), score=score)


@router.delete("/{score_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_score(score_id: uuid.UUID, session: Session, user: CurrentUser) -> Response:
    try:
        row = await score_for(session, score_id, user)
    except service.NotFound:
        raise _not_found() from None
    await session.delete(row)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{score_id}/revisions")
async def save_edit(
    score_id: uuid.UUID, body: SaveEdit, session: Session, user: CurrentUser
) -> Saved:
    try:
        await score_for(session, score_id, user)
        head = await service.save_edit(session, score_id, body.base, body.ops)
    except service.NotFound:
        raise _not_found() from None
    except service.Conflict as err:
        raise _conflict(err) from None
    except OpError as err:
        raise _op_error(err) from None
    return Saved(head=head)


@router.post("/{score_id}/restore")
async def restore(
    score_id: uuid.UUID, body: Restore, session: Session, user: CurrentUser
) -> ScoreDetail:
    try:
        await score_for(session, score_id, user)
        await service.restore(session, score_id, body.base, body.number)
        row = await service.get_score(session, score_id)
        score = await service.head_score(session, row)
    except service.NotFound:
        raise _not_found() from None
    except service.Conflict as err:
        raise _conflict(err) from None
    return ScoreDetail(**_summary(row).model_dump(), score=score)


@router.get("/{score_id}/history")
async def history(score_id: uuid.UUID, session: Session, user: CurrentUser) -> list[HistoryEntry]:
    try:
        await score_for(session, score_id, user)
        return await service.history(session, score_id)
    except service.NotFound:
        raise _not_found() from None


def get_suggest_model() -> Model:
    """FastAPI dependency (swapped out in tests)."""
    return make_model(effort=get_settings().suggest_effort)


@router.post("/{score_id}/suggest")
async def suggest(
    score_id: uuid.UUID,
    body: SuggestRequest,
    session: Session,
    model: Annotated[Model, Depends(get_suggest_model)],
    user: CurrentUser,
) -> SuggestResponse:
    """Tab autocomplete: notes for one hand in one bar. Empty `ops` means no suggestion."""
    try:
        await score_for(session, score_id, user)
        rev = await service.get_revision(session, score_id, body.base)
    except service.NotFound:
        raise _not_found() from None
    score = Score.model_validate(rev.snapshot)
    if body.measure > len(score.measures):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "bad_measure"})
    # Done with the database; don't hold a connection open during the model call.
    await session.close()
    try:
        result = await suggest_bar(score, body.measure, body.staff, model)
    except Exception:
        # Autocomplete is best-effort: a provider hiccup just means no suggestion.
        log.warning("suggestion failed", exc_info=True)
        return SuggestResponse(base=body.base, ops=[])
    return SuggestResponse(base=body.base, ops=result.ops)


@router.get("/{score_id}/revisions/{number}")
async def get_revision(
    score_id: uuid.UUID, number: int, session: Session, user: CurrentUser
) -> RevisionDetail:
    try:
        await score_for(session, score_id, user)
        rev = await service.get_revision(session, score_id, number)
    except service.NotFound:
        raise _not_found() from None
    return RevisionDetail(
        number=rev.number,
        message=rev.message,
        created_at=rev.created_at,
        score=Score.model_validate(rev.snapshot),
    )
