import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.agent.context import Selection
from app.score.model import Score

JobStatus = Literal["queued", "running", "ready", "failed", "accepted", "rejected"]


class CreateEdit(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    selection: Selection
    # The version the request was made against; 409 if the score has moved on.
    base: int


class EditJob(BaseModel):
    id: uuid.UUID
    score_id: uuid.UUID
    base: int
    instruction: str
    selection: Selection
    status: JobStatus
    model: str
    proposal: dict[str, Any] | None
    error: str | None
    accepted_revision: int | None
    created_at: datetime


class Accepted(BaseModel):
    head: int
    score: Score
    ops: list[dict[str, Any]]
