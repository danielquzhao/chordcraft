"""Database tables. See docs/PLAN.md ("Database")."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ScoreRow(Base):
    __tablename__ = "scores"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Supabase user id once auth lands (M6).
    owner_id: Mapped[str | None] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200))
    head: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RevisionRow(Base):
    """An immutable version of a score. Every save appends one; nothing is edited in place."""

    __tablename__ = "revisions"
    __table_args__ = (UniqueConstraint("score_id", "number"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    score_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scores.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int] = mapped_column(Integer)
    # "user" or "agent"
    author: Mapped[str] = mapped_column(String(16))
    # "create", "edit" or "restore"
    kind: Mapped[str] = mapped_column(String(16))
    message: Mapped[str] = mapped_column(String(200))
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    ops: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    # What the ops touched, for grouping history: {"kinds": [...], "measures": [...]}.
    changes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EditJobRow(Base):
    """One agent edit request: queued → running → ready/failed → accepted/rejected."""

    __tablename__ = "edit_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    score_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scores.id", ondelete="CASCADE"), index=True
    )
    # The version the agent read; accepting checks the score hasn't moved under it.
    base: Mapped[int] = mapped_column(Integer)
    instruction: Mapped[str] = mapped_column(String(2000))
    selection: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    # "bar" (⌘K inline edit) or "chat" (the agent panel, which also gets a reply message).
    source: Mapped[str] = mapped_column(String(8), default="bar", server_default="bar")
    model: Mapped[str] = mapped_column(String(64))
    # The agent's result: ops, summary, checks report, steps, usage and the drafted score.
    proposal: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(String(500))
    # The revision created when the proposal was accepted.
    accepted_revision: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MessageRow(Base):
    """The agent chat for a score. Assistant replies point at the edit job they came from."""

    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    score_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scores.id", ondelete="CASCADE"), index=True
    )
    # "user" or "assistant"
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("edit_jobs.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
