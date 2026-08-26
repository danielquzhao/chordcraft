"""Who can touch what: a score belongs to the user who created it.

Someone else's score looks exactly like a missing one (404), so ids can't be probed. With auth
off (local development) everything is accessible.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import User
from app.edits import service as edits
from app.models import EditJobRow, ScoreRow
from app.scores import service as scores


async def score_for(session: AsyncSession, score_id: uuid.UUID, user: User) -> ScoreRow:
    """Raises scores.NotFound if the score is missing or belongs to someone else."""
    row = await scores.get_score(session, score_id)
    if user.id is not None and row.owner_id != user.id:
        raise scores.NotFound(score_id)
    return row


async def job_for(session: AsyncSession, job_id: uuid.UUID, user: User) -> EditJobRow:
    """Raises edits.NotFound if the job is missing or its score belongs to someone else."""
    job = await edits.get_job(session, job_id)
    try:
        await score_for(session, job.score_id, user)
    except scores.NotFound:
        raise edits.NotFound(job_id) from None
    return job
