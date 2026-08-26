# One image for both backend services:
#   API:    the default command (runs migrations, then serves on $PORT)
#   Worker: start command `arq app.worker.WorkerSettings`
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so code changes don't reinstall them: install the project against an
# empty package to pull in its dependencies, then remove the placeholder itself so it can't
# shadow the real code (which runs from /app via PYTHONPATH).
COPY pyproject.toml ./
RUN mkdir app && touch app/__init__.py && pip install . \
    && pip uninstall -y chordcraft-api && rm -rf app build

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app

RUN useradd --create-home chordcraft
USER chordcraft

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
