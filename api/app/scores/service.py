"""Score storage: every change appends an immutable revision and moves the score's head."""

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RevisionRow, ScoreRow
from app.score.model import Measure, Score
from app.score.ops import Op, apply_ops
from app.scores import summary
from app.scores.schemas import HistoryEntry

# Consecutive user edits closer together than this show as one History entry.
HISTORY_GROUP_GAP = timedelta(seconds=60)
HISTORY_LIMIT = 500


class NotFound(Exception):
    pass


class Conflict(Exception):
    def __init__(self, head: int):
        super().__init__(f"score is at version {head}")
        self.head = head


def blank_score() -> Score:
    return Score(measures=[Measure(n=n) for n in range(1, 5)])


async def create_score(session: AsyncSession, score: Score | None) -> tuple[ScoreRow, Score]:
    score = score or blank_score()
    row = ScoreRow(title=score.meta.title, head=1)
    session.add(row)
    await session.flush()
    session.add(
        RevisionRow(
            score_id=row.id,
            number=1,
            author="user",
            kind="create",
            message="Created",
            snapshot=score.model_dump(mode="json"),
            ops=[],
            changes={},
        )
    )
    await session.commit()
    await session.refresh(row)
    return row, score


async def get_score(session: AsyncSession, score_id: uuid.UUID, *, lock: bool = False) -> ScoreRow:
    row = await session.get(ScoreRow, score_id, with_for_update=lock)
    if row is None:
        raise NotFound(score_id)
    return row


async def get_revision(session: AsyncSession, score_id: uuid.UUID, number: int) -> RevisionRow:
    row = await session.scalar(
        select(RevisionRow).where(RevisionRow.score_id == score_id, RevisionRow.number == number)
    )
    if row is None:
        raise NotFound(number)
    return row


async def head_score(session: AsyncSession, row: ScoreRow) -> Score:
    revision = await get_revision(session, row.id, row.head)
    return Score.model_validate(revision.snapshot)


async def append_revision(
    session: AsyncSession,
    row: ScoreRow,
    *,
    snapshot: Score,
    kind: str,
    message: str,
    ops: list[dict[str, Any]],
    changes: summary.Changes,
    author: str = "user",
) -> int:
    row.head += 1
    row.title = snapshot.meta.title
    session.add(
        RevisionRow(
            score_id=row.id,
            number=row.head,
            author=author,
            kind=kind,
            message=message,
            snapshot=snapshot.model_dump(mode="json"),
            ops=ops,
            changes=changes.model_dump(),
        )
    )
    await session.flush()
    # Bump updated_at to the revision's timestamp (the transaction's now()).
    row.updated_at = (await get_revision(session, row.id, row.head)).created_at
    await session.commit()
    return row.head


async def save_edit(session: AsyncSession, score_id: uuid.UUID, base: int, ops: list[Op]) -> int:
    """Apply ops on top of version `base`. Raises Conflict if that is no longer the head,
    and OpError if the ops don't apply."""
    row = await get_score(session, score_id, lock=True)
    if base != row.head:
        raise Conflict(row.head)
    current = await head_score(session, row)
    updated = apply_ops(current, ops)
    changes = summary.describe(current, ops)
    return await append_revision(
        session,
        row,
        snapshot=updated,
        kind="edit",
        message=summary.message(changes),
        ops=[op.model_dump(mode="json", exclude_none=True) for op in ops],
        changes=changes,
    )


async def restore(session: AsyncSession, score_id: uuid.UUID, base: int, number: int) -> int:
    """Make an old version the new head, as a new revision (history is never rewritten)."""
    row = await get_score(session, score_id, lock=True)
    if base != row.head:
        raise Conflict(row.head)
    old = await get_revision(session, score_id, number)
    return await append_revision(
        session,
        row,
        snapshot=Score.model_validate(old.snapshot),
        kind="restore",
        message=f"Restored v{number}",
        ops=[],
        changes=summary.Changes(),
    )


async def history(session: AsyncSession, score_id: uuid.UUID) -> list[HistoryEntry]:
    await get_score(session, score_id)
    rows = (
        await session.scalars(
            select(RevisionRow)
            .where(RevisionRow.score_id == score_id)
            .order_by(RevisionRow.number.desc())
            .limit(HISTORY_LIMIT)
        )
    ).all()

    groups: list[list[RevisionRow]] = []
    for rev in reversed(rows):
        last = groups[-1][-1] if groups else None
        joins = (
            last is not None
            and rev.kind == "edit"
            and last.kind == "edit"
            and rev.author == "user"
            and last.author == "user"
            and rev.created_at - last.created_at <= HISTORY_GROUP_GAP
        )
        if joins:
            groups[-1].append(rev)
        else:
            groups.append([rev])

    entries = []
    for group in reversed(groups):
        first, last = group[0], group[-1]
        if last.kind == "edit" and last.author == "user":
            text = summary.message(
                summary.merge(summary.Changes.model_validate(r.changes) for r in group)
            )
        else:
            text = last.message
        entries.append(
            HistoryEntry(
                number=last.number,
                first_number=first.number,
                author=last.author,  # type: ignore[arg-type]
                kind=last.kind,  # type: ignore[arg-type]
                message=text,
                created_at=last.created_at,
            )
        )
    return entries
