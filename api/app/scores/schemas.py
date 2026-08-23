import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.score.model import Score
from app.score.ops import Op


class CreateScore(BaseModel):
    """Start from a given score, or from a blank one when omitted."""

    score: Score | None = None


class ScoreSummary(BaseModel):
    id: uuid.UUID
    title: str
    head: int
    updated_at: datetime


class ScoreDetail(ScoreSummary):
    score: Score


class SaveEdit(BaseModel):
    """Ops made against version `base`. Rejected with 409 if the score has moved on."""

    base: int
    ops: list[Op] = Field(min_length=1, max_length=2000)


class Restore(BaseModel):
    base: int
    number: int


class Saved(BaseModel):
    head: int


class HistoryEntry(BaseModel):
    """One row in the History panel; a burst of quick edits shows as a single entry."""

    number: int
    first_number: int
    author: Literal["user", "agent"]
    kind: Literal["create", "edit", "restore"]
    message: str
    created_at: datetime


class RevisionDetail(BaseModel):
    number: int
    message: str
    created_at: datetime
    score: Score
