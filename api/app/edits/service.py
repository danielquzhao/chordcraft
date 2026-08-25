"""Edit jobs: create, run (in the worker), accept, reject."""

import logging
import uuid
from collections.abc import Callable
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agent.context import Selection
from app.agent.graph import run_agent
from app.agent.model import Model, make_model
from app.config import get_settings
from app.edits import events
from app.models import EditJobRow, MessageRow, ScoreRow
from app.score.model import Score
from app.score.ops import AddNote, OpError, OpList, RemoveNote, SetChord, UpdateNote, apply_ops
from app.scores import service as scores
from app.scores import summary

log = logging.getLogger(__name__)

OPEN = {"queued", "running"}


class NotFound(Exception):
    pass


class InvalidState(Exception):
    def __init__(self, status: str):
        super().__init__(f"the edit is {status}")
        self.status = status


async def create_job(
    session: AsyncSession,
    score_id: uuid.UUID,
    base: int,
    instruction: str,
    selection: Selection,
    source: str = "bar",
) -> EditJobRow:
    """Raises scores.NotFound, scores.Conflict (stale base) or ValueError (bad selection)."""
    score_row = await scores.get_score(session, score_id)
    if base != score_row.head:
        raise scores.Conflict(score_row.head)
    score = await scores.head_score(session, score_row)
    if selection.end > len(score.measures):
        raise ValueError(f"the score has {len(score.measures)} measures")
    job = EditJobRow(
        score_id=score_id,
        base=base,
        instruction=instruction,
        selection=selection.model_dump(),
        status="queued",
        source=source,
        model=get_settings().agent_model,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def get_job(session: AsyncSession, job_id: uuid.UUID, *, lock: bool = False) -> EditJobRow:
    job = await session.get(EditJobRow, job_id, with_for_update=lock)
    if job is None:
        raise NotFound(job_id)
    return job


async def run_job(
    sessions: async_sessionmaker[AsyncSession],
    redis: Redis,
    job_id: str,
    model_factory: Callable[[], Model] = make_model,
) -> str:
    """Run the agent for a queued job and store its proposal. Returns the final status."""
    jid = uuid.UUID(job_id)
    async with sessions() as session:
        job = await get_job(session, jid)
        if job.status != "queued":
            return job.status
        base = Score.model_validate(
            (await scores.get_revision(session, job.score_id, job.base)).snapshot
        )
        selection = Selection.model_validate(job.selection)
        instruction = job.instruction
        chat = job.source == "chat"
        history = await chat_history(session, job) if chat else []
        job.status = "running"
        await session.commit()
    await events.publish(redis, job_id, {"type": "status", "status": "running"})

    async def relay(event: dict[str, Any]) -> None:
        await events.publish(redis, job_id, event)

    proposal: dict[str, Any] | None = None
    error: str | None = None
    try:
        result = await run_agent(
            base,
            selection,
            instruction,
            model_factory(),
            on_event=relay,
            history=history,
            conversational=chat,
        )
        status = result.status
        error = result.error
        proposal = result.model_dump(mode="json")
    except Exception:
        log.exception("edit job %s crashed", job_id)
        status, error = "failed", "The agent ran into an error. Please try again."

    async with sessions() as session:
        job = await get_job(session, jid, lock=True)
        if job.status == "running":  # not rejected while it ran
            job.status = status
            job.proposal = proposal
            job.error = error
            if chat:
                reply = (proposal or {}).get("summary") or error or "Done."
                session.add(
                    MessageRow(score_id=job.score_id, role="assistant", content=reply, job_id=jid)
                )
        final = job.status
        await session.commit()
    await events.publish(redis, job_id, {"type": "done", "status": final, "error": error})
    return final


HISTORY_MESSAGES = 8


async def chat_history(session: AsyncSession, job: EditJobRow) -> list[tuple[str, str]]:
    """The chat turns before this job's request, oldest first."""
    rows = await session.scalars(
        select(MessageRow)
        .where(
            MessageRow.score_id == job.score_id,
            MessageRow.created_at < job.created_at,
            or_(MessageRow.job_id.is_(None), MessageRow.job_id != job.id),
        )
        .order_by(MessageRow.created_at.desc())
        .limit(HISTORY_MESSAGES)
    )
    return [(m.role, m.content) for m in reversed(rows.all())]


def _touched(score: Score, ops: list[Any]) -> tuple[set[tuple[int, str]], set[int]]:
    """(measure, staff) pairs whose notes the ops change, and measures whose chord they set."""
    where = {n.id: (m.n, n.staff) for m in score.measures for n in m.notes}
    notes: set[tuple[int, str]] = set()
    chords: set[int] = set()
    for op in ops:
        match op:
            case AddNote():
                notes.add((op.measure, op.note.staff))
            case RemoveNote() | UpdateNote():
                if op.id in where:
                    notes.add(where[op.id])
            case SetChord():
                chords.add(op.measure)
    return notes, chords


def _region(score: Score, measure: int, staff: str) -> list[Any]:
    return [n for n in score.measures[measure - 1].notes if n.staff == staff]


def rebase(base: Score, head: Score, ops: list[Any]) -> Score | None:
    """Apply ops made against `base` onto a newer `head`, if nothing they touch has changed."""
    if len(base.measures) != len(head.measures):
        return None
    notes, chords = _touched(base, ops)
    for measure, staff in notes:
        if _region(base, measure, staff) != _region(head, measure, staff):
            return None
    for measure in chords:
        if base.measures[measure - 1].chord != head.measures[measure - 1].chord:
            return None
    try:
        return apply_ops(head, ops)
    except OpError:
        return None


async def accept(session: AsyncSession, job_id: uuid.UUID) -> tuple[int, Score, list[dict]]:
    """Save a ready proposal as a new agent revision. Raises InvalidState or scores.Conflict."""
    job = await get_job(session, job_id, lock=True)
    if job.status != "ready" or not job.proposal:
        raise InvalidState(job.status)
    if not job.proposal["ops"]:
        # An answer to a question, or a request the agent declined: nothing to apply.
        raise InvalidState("empty")
    raw_ops = job.proposal["ops"]
    ops = OpList.validate_python(raw_ops)
    row: ScoreRow = await scores.get_score(session, job.score_id, lock=True)
    head = await scores.head_score(session, row)
    if row.head == job.base:
        updated = apply_ops(head, ops)
    else:
        base = Score.model_validate((await scores.get_revision(session, row.id, job.base)).snapshot)
        rebased = rebase(base, head, ops)
        if rebased is None:
            raise scores.Conflict(row.head)
        updated = rebased
    job.status = "accepted"
    number = await scores.append_revision(
        session,
        row,
        snapshot=updated,
        kind="edit",
        author="agent",
        message=job.instruction[:200],
        ops=raw_ops,
        changes=summary.describe(head, ops),
    )
    job.accepted_revision = number
    await session.commit()
    return number, updated, raw_ops


async def reject(session: AsyncSession, job_id: uuid.UUID) -> None:
    job = await get_job(session, job_id, lock=True)
    if job.status not in OPEN | {"ready", "failed"}:
        raise InvalidState(job.status)
    job.status = "rejected"
    await session.commit()
